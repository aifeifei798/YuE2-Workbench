"""母带服务:Beautiful-Singing-Voice-VST3 一键链的移植版。

de-clip → 人声/配乐各自 EQ+de-esser+压缩+闪避+加厚 → 合成 → 限制器 → LUFS 归一。
有 HTDemucs 分轨(版本目录 stems/)时走完整双链;没有就退回"整轨打磨"模式。
输出采样率跟随源音频(YuE2 生成是 48kHz);44.1kHz 的分轨会用 resample_poly
重采样到源的时钟上,避免重唱感。
"""

from __future__ import annotations

import hashlib
import subprocess
import tempfile
import threading
from collections import OrderedDict
from dataclasses import dataclass, replace
from math import gcd
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

from .master_dsp import (
    BLOCK,
    Params,
    PRESETS,
    add_doubling,
    band,
    block_rms_db,
    deesser,
    duck,
    lufs,
    music_chain,
    normalize_loudness,
    peak_db,
    preset_names,
    reverb,
    rms_db,
    soft_declip,
    vocal_chain,
)

STEM_NAMES = ("vocals", "drums", "bass", "other")


def src_cache_key(src: str) -> str:
    """源文件的稳定缓存键(与 tasks._src_cache_key 同配方,避免为它引入 torch)。"""
    p = Path(src).resolve()
    st = p.stat()
    h = hashlib.sha1(f"{p}|{st.st_mtime_ns}|{st.st_size}".encode()).hexdigest()[:10]
    return f"{p.stem[:24]}_{h}"


def resolve_params(preset: str | None, overrides: dict | None) -> Params:
    """预设全量参数 + 用户覆盖。未知键忽略,保证旧前端存的参数还能读。"""
    base = PRESETS.get(preset or "", Params())
    if not overrides:
        return replace(base)
    known = {k: v for k, v in overrides.items() if k in Params.__dataclass_fields__}
    return replace(base, **known)


# --------------------------------------------------------------------------
# 音频加载(带进程内 LRU,预览改旋钮不重复解码)
# --------------------------------------------------------------------------
@dataclass
class MasterSource:
    path: str
    sr: int
    original: np.ndarray  # (n, 2) float32
    vocal: np.ndarray | None = None
    music: np.ndarray | None = None

    @property
    def has_stems(self) -> bool:
        return self.vocal is not None and self.music is not None


def _decode_stereo(path: Path) -> tuple[np.ndarray, int]:
    """任意格式 → (n, 2) float32,保持原始采样率。"""
    try:
        data, sr = sf.read(str(path), dtype="float32", always_2d=True)
    except Exception:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp_path = tmp.name
        try:
            subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-i", str(path), "-ac", "2", "-f", "wav", tmp_path],
                check=True, capture_output=True,
            )
            data, sr = sf.read(tmp_path, dtype="float32", always_2d=True)
        finally:
            Path(tmp_path).unlink(missing_ok=True)
    if data.shape[1] == 1:
        data = np.repeat(data, 2, axis=1)
    return np.ascontiguousarray(data), int(sr)


def _resample_to(x: np.ndarray, sr_in: int, sr_out: int) -> np.ndarray:
    if sr_in == sr_out:
        return x
    g = gcd(sr_in, sr_out)
    return resample_poly(x, sr_out // g, sr_in // g, axis=0).astype(np.float32)


def _load_source_uncached(path: Path, stems_dir: Path | None) -> MasterSource:
    original, sr = _decode_stereo(path)
    src = MasterSource(path=str(path), sr=sr, original=original)

    if stems_dir is not None and (stems_dir / "vocals.flac").exists():
        stem_sr = sf.info(str(stems_dir / "vocals.flac")).samplerate
        vocal, _ = _decode_stereo(stems_dir / "vocals.flac")
        total = None
        for name in ("drums", "bass", "other"):
            p = stems_dir / f"{name}.flac"
            if not p.exists():
                continue
            stem, _ = _decode_stereo(p)
            total = stem if total is None else total + stem
        if total is not None:
            music = total
        else:
            # 只有 vocals:用原始轨减人声兜底
            music = original - vocal
        n = min(original.shape[0], vocal.shape[0], music.shape[0])
        src.original = np.ascontiguousarray(original[:n])
        src.vocal = np.ascontiguousarray(_resample_to(vocal, stem_sr, sr)[:n])
        src.music = np.ascontiguousarray(_resample_to(music, stem_sr, sr)[:n])
    return src


def _stems_signature(stems_dir: Path | None) -> tuple:
    if stems_dir is None or not (stems_dir / "vocals.flac").exists():
        return ()
    sig = []
    for name in STEM_NAMES:
        p = stems_dir / f"{name}.flac"
        if p.exists():
            st = p.stat()
            sig.append((name, st.st_mtime_ns, st.st_size))
    return tuple(sig)


_CACHE: OrderedDict[tuple, MasterSource] = OrderedDict()
_CACHE_LOCK = threading.Lock()
_CACHE_MAX = 2


def load_source(path: str | Path, stems_dir: str | Path | None = None) -> MasterSource:
    """加载源音频(优先复用分轨),进程内最多缓存 2 份。"""
    path = Path(path)
    stems_dir = Path(stems_dir) if stems_dir else None
    st = path.stat()
    key = (str(path.resolve()), st.st_mtime_ns, st.st_size, _stems_signature(stems_dir))
    with _CACHE_LOCK:
        hit = _CACHE.get(key)
        if hit is not None:
            _CACHE.move_to_end(key)
            return hit
    src = _load_source_uncached(path, stems_dir)
    with _CACHE_LOCK:
        _CACHE[key] = src
        while len(_CACHE) > _CACHE_MAX:
            _CACHE.popitem(last=False)
    return src


# --------------------------------------------------------------------------
# 渲染(移植自 bsv/pipeline.py 的 Project.render)
# --------------------------------------------------------------------------
def render(src: MasterSource, params: Params, start: float | None = None, end: float | None = None,
           preroll: float = 2.0) -> dict:
    """渲染整曲或时间窗口(秒)。窗口用于试听:预卷 2s 让滤波器/混响先稳定。"""
    sr = src.sr
    n = src.original.shape[0]
    if start is None:
        i0, i1 = 0, n
        window_start = 0.0
    else:
        i0 = int(max(0.0, start - preroll) * sr)
        i1 = int(min(float(end) if end is not None else n / sr, n / sr) * sr)
        window_start = float(start)
        i1 = max(i1, i0 + 1)

    original = soft_declip(src.original[i0:i1], params.declip_knee)

    if src.has_stems:
        vocal = soft_declip(src.vocal[i0:i1], params.declip_knee)
        music = soft_declip(src.music[i0:i1], params.declip_knee)

        for plugin in vocal_chain(params, sr):
            vocal = plugin(vocal, sr)
        vocal = deesser_wrap(vocal, sr, params)
        vocal = reverb(vocal, sr, params.reverb_room, params.reverb_wet, params.reverb_damping)
        vocal = add_doubling(vocal, sr, params.doubling_db, params.doubling_ms)
        vocal = vocal * np.exp(params.vocal_gain_db * np.log(10) / 20.0)

        for plugin in music_chain(params, sr):
            music = plugin(music, sr)
        music = duck(music, vocal, sr, params.duck_db, params.duck_lo_hz,
                     params.duck_hi_hz, params.duck_threshold_db,
                     params.duck_attack_ms, params.duck_release_ms)
        music = music * np.exp(params.music_gain_db * np.log(10) / 20.0)
        mode = "stems"
    else:
        # 兜底:没有分轨,整轨打磨
        mix = original
        for plugin in vocal_chain(params, sr):
            mix = plugin(mix, sr)
        mix = deesser_wrap(mix, sr, params)
        mix = reverb(mix, sr, params.reverb_room * 0.6, params.reverb_wet * 0.5, params.reverb_damping)
        vocal, music = mix, mix
        mode = "mix_only"

    mix = vocal + music
    lufs_before = lufs(original, sr)
    mix = normalize_loudness(mix, sr, params.target_lufs)

    return {
        "mix": mix,
        "vocal": vocal,
        "music": music,
        "mode": mode,
        "stats": {
            "lufs_before": round(float(lufs_before), 2),
            "lufs_after": round(float(lufs(mix, sr)), 2),
            "peak_before_db": round(float(peak_db(original)), 2),
            "peak_after_db": round(float(peak_db(mix)), 2),
            "vocal_ratio_db": round(float(rms_db(vocal) - rms_db(music)), 2),
        },
        "offset_sec": i0 / sr,
        "window_start": window_start,
        "duration_sec": (i1 - i0) / sr,
    }


def deesser_wrap(x: np.ndarray, sr: int, params: Params) -> np.ndarray:
    """自适应 de-esser:阈值跟轨道自己的人声电平走,安静的混音不会被过度处理。"""
    core_level = float(np.mean(block_rms_db(band(x, sr, 300.0, 3000.0), sr, 50.0)))
    threshold = float(np.clip(core_level + params.deesser_offset_db, -40.0, -12.0))

    out = deesser(x, sr, params.deesser_hz, threshold, params.deesser_amount)
    out = deesser(out, sr, params.deesser_hz2, threshold + 3.0, params.deesser_amount * 0.7)
    return out


# --------------------------------------------------------------------------
# 整曲导出
# --------------------------------------------------------------------------
def master_to_file(src_path: str | Path, stems_dir: str | Path | None, params: Params,
                   out_path: str | Path, emit=None, cancelled=None) -> dict:
    """整曲渲染并落盘 FLAC(PCM_24)。返回统计 dict。"""
    emit = emit or (lambda **e: None)

    emit(stage="load", detail="decoding audio + stems")
    src = load_source(src_path, stems_dir)
    if cancelled is not None and cancelled():
        raise InterruptedError()

    emit(stage="render", detail=f"mastering {src.original.shape[0] / src.sr:.0f}s ({'分轨双链' if src.has_stems else '整轨模式'})")
    out = render(src, params)
    if cancelled is not None and cancelled():
        raise InterruptedError()

    emit(stage="export", detail=str(out_path))
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(out_path), out["mix"], src.sr, subtype="PCM_24")

    return {
        **out["stats"],
        "mode": out["mode"],
        "samplerate": src.sr,
        "duration": round(float(out["duration_sec"]), 2),
    }

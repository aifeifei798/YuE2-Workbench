# Copyright 2026 Feifei
# SPDX-License-Identifier: GPL-3.0-only

"""母带 DSP 原语:soft de-clip / EQ / de-esser / 侧链闪避 / 加厚 / 限制器 / LUFS。

移植自 Beautiful-Singing-Voice-VST3 的 bsv/dsp.py + bsv/filters.py + bsv/presets.py,
数学与系数保持一致,预设名也原样沿用。所有函数吃 (n_samples, 2) float32 numpy 数组
和采样率;EQ 用 scipy biquad(pedalboard 的逐样本 IIR 插件在整曲上慢 ~30 倍,
频响已对齐到零点几 dB),压缩/混响/限制器仍用 pedalboard(它这几件足够快)。
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
from pedalboard import BrickwallLimiter, Compressor, Reverb
from scipy.signal import butter, sosfilt

LOG10_20 = np.log(10.0) / 20.0
EPS = 1e-12
# 逐样本阶段用的分块大小:262k 采样(约 6s@44.1k),整块临时数组留在缓存里,
# 整曲渲染不随系统内存压力抖动。
BLOCK = 1 << 18


# --------------------------------------------------------------------------
# fast EQ:RBJ cookbook 双二阶,scipy SOS
# --------------------------------------------------------------------------
def _linear_gain(gain_db: float) -> float:
    return 10.0 ** (gain_db / 20.0)


def _prewarped(cf_hz: float, sr: int) -> float:
    """tan(pi f / sr):双线性变换在 cf_hz 处的频率预畸变。"""
    return float(np.tan(np.pi * float(cf_hz) / sr))


def _normalise(sos: np.ndarray) -> np.ndarray:
    return sos / sos[:, 3]


def highpass_sos(cf_hz: float, sr: int, order: int = 1) -> np.ndarray:
    if order == 1:
        k = _prewarped(cf_hz, sr)
        return np.array([[1.0 / (1.0 + k), -1.0 / (1.0 + k), 0.0, 1.0, (k - 1.0) / (1.0 + k), 0.0]])
    nyquist = sr / 2.0
    w = min(max(cf_hz, 1.0) / nyquist, 0.999)
    return butter(order, w, btype="highpass", output="sos")


def lowpass_sos(cf_hz: float, sr: int, order: int = 1) -> np.ndarray:
    if order == 1:
        k = _prewarped(cf_hz, sr)
        return np.array([[k / (1.0 + k), k / (1.0 + k), 0.0, 1.0, (k - 1.0) / (1.0 + k), 0.0]])
    nyquist = sr / 2.0
    w = min(max(cf_hz, 1.0) / nyquist, 0.999)
    return butter(order, w, btype="lowpass", output="sos")


def peak_sos(cf_hz: float, q: float, gain_db: float, sr: int) -> np.ndarray:
    """峰值 EQ:cf_hz 处 gain_db,Q 控制带宽。"""
    if gain_db == 0.0:
        return np.array([[1.0, 0.0, 0.0, 1.0, 0.0, 0.0]])
    k = _prewarped(cf_hz, sr)
    zeta = 1.0 / (2.0 * max(q, 0.1))
    a = _linear_gain(gain_db)

    b = [1.0 + 2.0 * zeta * k * a + k * k, 2.0 * (k * k - 1.0), 1.0 - 2.0 * zeta * k * a + k * k]
    d = [1.0 + 2.0 * zeta * k + k * k, 2.0 * (k * k - 1.0), 1.0 - 2.0 * zeta * k + k * k]
    return _normalise(np.array([[b[0], b[1], b[2], d[0], d[1], d[2]]], dtype=np.float64))


def _shelf_section(a: float, k: float, low: bool) -> list[float]:
    if low:  # 低架:角频以下增益 a,以上全通
        b0, b1 = (1.0 + a * k) / (1.0 + k), (a * k - 1.0) / (1.0 + k)
    else:  # 高架:角频以上增益 a,以下全通
        b0, b1 = (a + k) / (1.0 + k), (k - a) / (1.0 + k)
    return [b0, b1, 0.0, 1.0, (k - 1.0) / (1.0 + k), 0.0]


def low_shelf_sos(cf_hz: float, gain_db: float, sr: int) -> np.ndarray:
    if gain_db == 0.0:
        return np.array([[1.0, 0.0, 0.0, 1.0, 0.0, 0.0]])
    a = _linear_gain(gain_db) ** 0.5  # 两级级联才是全额增益
    k = _prewarped(cf_hz, sr)
    return np.array([_shelf_section(a, k, True), _shelf_section(a, k, True)])


def high_shelf_sos(cf_hz: float, gain_db: float, sr: int) -> np.ndarray:
    if gain_db == 0.0:
        return np.array([[1.0, 0.0, 0.0, 1.0, 0.0, 0.0]])
    a = _linear_gain(gain_db) ** 0.5
    k = _prewarped(cf_hz, sr)
    return np.array([_shelf_section(a, k, False), _shelf_section(a, k, False)])


class Filter:
    """一组二阶节,像 pedalboard 插件一样可调用。

    所有节打包进一个 SOS 矩阵,scipy 一趟跑完全部 EQ,不为每级分配新数组。
    """

    def __init__(self, sections: list[np.ndarray]):
        parts = [np.asarray(s, dtype=np.float64) for s in sections if s is not None]
        if not parts:
            parts = [np.array([[1.0, 0.0, 0.0, 1.0, 0.0, 0.0]])]
        self.sections = np.vstack(parts)

    def __call__(self, x: np.ndarray, sr: int) -> np.ndarray:
        return np.asarray(sosfilt(self.sections, x, axis=0), dtype=np.float32)


def band_filter(lo_hz: float, hi_hz: float, sr: int) -> Filter:
    return Filter([highpass_sos(lo_hz, sr), lowpass_sos(hi_hz, sr)])


# --------------------------------------------------------------------------
# ITU-R BS.1770 K 加权(LUFS 表用的滤波器)
# --------------------------------------------------------------------------
def _rbj_section(filter_type: str, gain_db: float, q: float, cf_hz: float, sr: int) -> np.ndarray:
    """RBJ cookbook 双二阶,系数与 pyloudnorm 一致。"""
    a = 10.0 ** (gain_db / 40.0)
    w0 = 2.0 * np.pi * (cf_hz / sr)
    alpha = np.sin(w0) / (2.0 * q)
    cos_w = np.cos(w0)

    if filter_type == "high_shelf":
        b = [
            a * ((a + 1) + (a - 1) * cos_w + 2 * np.sqrt(a) * alpha),
            -2 * a * ((a - 1) + (a + 1) * cos_w),
            a * ((a + 1) + (a - 1) * cos_w - 2 * np.sqrt(a) * alpha),
        ]
        d = [
            (a + 1) - (a - 1) * cos_w + 2 * np.sqrt(a) * alpha,
            2 * ((a - 1) - (a + 1) * cos_w),
            (a + 1) - (a - 1) * cos_w - 2 * np.sqrt(a) * alpha,
        ]
    elif filter_type == "low_shelf":
        b = [
            a * ((a + 1) - (a - 1) * cos_w + 2 * np.sqrt(a) * alpha),
            2 * a * ((a - 1) - (a + 1) * cos_w),
            a * ((a + 1) - (a - 1) * cos_w - 2 * np.sqrt(a) * alpha),
        ]
        d = [
            (a + 1) + (a - 1) * cos_w + 2 * np.sqrt(a) * alpha,
            -2 * ((a - 1) + (a + 1) * cos_w),
            (a + 1) + (a - 1) * cos_w - 2 * np.sqrt(a) * alpha,
        ]
    elif filter_type == "high_pass":
        b = [(1 + cos_w) / 2, -(1 + cos_w), (1 + cos_w) / 2]
        d = [1 + alpha, -2 * cos_w, 1 - alpha]
    else:  # peaking
        b = [1 + alpha * a, -2 * cos_w, 1 - alpha * a]
        d = [1 + alpha / a, -2 * cos_w, 1 - alpha / a]

    return _normalise(np.array([b + d], dtype=np.float64))


def k_weighting_sos(sr: int) -> list[np.ndarray]:
    """K 加权:1500 Hz 处 +4 dB 高架,再接一个 38 Hz 高通。"""
    return [
        _rbj_section("high_shelf", 4.0, 1 / np.sqrt(2), 1500.0, sr),
        _rbj_section("high_pass", 0.0, 0.5, 38.0, sr),
    ]


# --------------------------------------------------------------------------
# repair
# --------------------------------------------------------------------------
def soft_declip(x: np.ndarray, knee: float = 0.94) -> np.ndarray:
    """把削顶的平顶圆滑掉,而不是再硬削一次。"""
    x = np.asarray(x, dtype=np.float32)
    abs_x = np.abs(x)
    over = abs_x > knee
    if not over.any():
        return x
    out = x.copy()
    span = 1.0 - knee
    scaled = (abs_x[over] - knee) / span
    out[over] = np.sign(x[over]) * (knee + span * np.tanh(scaled))
    return out


# --------------------------------------------------------------------------
# 包络辅助(分块、向量化)
# --------------------------------------------------------------------------
def _block_size(sr: int, block_ms: float) -> int:
    return max(1, int(sr * block_ms / 1000.0))


def block_rms_db(x: np.ndarray, sr: int, block_ms: float = 4.0) -> np.ndarray:
    """每块的 RMS 电平(dB),形状 (n_blocks, channels)。"""
    block = _block_size(sr, block_ms)
    n = x.shape[0]
    n_blocks = (n + block - 1) // block
    padded = np.pad(x, ((0, n_blocks * block - n), (0, 0)))
    blocks = padded.reshape(n_blocks, block, x.shape[1])
    rms = np.sqrt(np.mean(blocks * blocks, axis=1))
    return 20.0 * np.log10(np.maximum(rms, EPS))


def smooth_blocks(values: np.ndarray, sr: int, attack_ms: float, release_ms: float,
                  block_ms: float = 4.0) -> np.ndarray:
    """块值上的单极点平滑,起音/释放分开。"""
    block = _block_size(sr, block_ms)
    attack = np.exp(-block / (sr * max(attack_ms, 0.1) / 1000.0))
    release = np.exp(-block / (sr * max(release_ms, 0.1) / 1000.0))
    out = np.empty_like(values)
    prev = values[0].copy()
    for i in range(values.shape[0]):
        target = values[i]
        coeff = np.where(target < prev, attack, release)  # 衰减更深 = 更快
        prev = prev + coeff * (target - prev)
        out[i] = prev
    return out


# --------------------------------------------------------------------------
# EQ / 动态
# --------------------------------------------------------------------------
def band(x: np.ndarray, sr: int, lo_hz: float, hi_hz: float) -> np.ndarray:
    """级联高通+低通近似带通隔离。"""
    return band_filter(lo_hz, hi_hz, sr)(x, sr)


def deesser(
    x: np.ndarray,
    sr: int,
    center_hz: float,
    threshold_db: float,
    amount: float,
    attack_ms: float = 4.0,
    release_ms: float = 40.0,
    half_width_hz: float = 1200.0,
) -> np.ndarray:
    """只在齿音带冲过阈值时压它。"""
    if amount <= 0.0:
        return x
    lo = max(200.0, center_hz - half_width_hz / 2.0)
    hi = min(sr / 2.0 - 100.0, center_hz + half_width_hz / 2.0)
    targeted = band(x, sr, lo, hi)

    block_ms = 2.0
    env_db = block_rms_db(targeted, sr, block_ms)
    gain_blocks = smooth_blocks(
        -amount * np.maximum(0.0, env_db - threshold_db), sr, attack_ms, release_ms, block_ms
    )

    block = _block_size(sr, block_ms)
    out = x.copy()
    n = x.shape[0]
    for i in range(0, n, BLOCK):
        j = min(i + BLOCK, n)
        linear = np.exp(gain_blocks[np.arange(i, j) // block] * LOG10_20) - 1.0
        out[i:j] += targeted[i:j] * linear
    return out.astype(np.float32, copy=False)


def duck(
    music: np.ndarray,
    vocal: np.ndarray,
    sr: int,
    duck_db: float,
    lo_hz: float = 250.0,
    hi_hz: float = 4000.0,
    threshold_db: float = -28.0,
    attack_ms: float = 40.0,
    release_ms: float = 260.0,
) -> np.ndarray:
    """人声活跃时把伴奏在人声频段里往下推。"""
    if duck_db <= 0.0:
        return music

    block_ms = 5.0
    env_db = block_rms_db(vocal, sr, block_ms)
    active = np.clip((env_db - threshold_db) / 8.0, 0.0, 1.0)
    active = smooth_blocks(active, sr, attack_ms, release_ms, block_ms)
    gain_blocks = -duck_db * active

    block = _block_size(sr, block_ms)
    mid = band(music, sr, lo_hz, hi_hz)
    out = music.copy()
    n = music.shape[0]
    for i in range(0, n, BLOCK):
        j = min(i + BLOCK, n)
        linear = np.exp(gain_blocks[np.arange(i, j) // block] * LOG10_20)
        out[i:j] -= mid[i:j] * (1.0 - linear)
    return out.astype(np.float32, copy=False)


# --------------------------------------------------------------------------
# 响度
# --------------------------------------------------------------------------
def _block_powers(weighted: np.ndarray, sr: int, block: int, lo: np.ndarray, hi: np.ndarray,
                  gains: np.ndarray) -> np.ndarray:
    """每个门控块的平均功率,按 BS.1770 通道增益跨声道求和。"""
    total = np.zeros(lo.shape[0], dtype=np.float64)
    for ch in range(weighted.shape[1]):
        c = np.empty(weighted.shape[0] + 1, dtype=np.float64)
        c[0] = 0.0
        np.cumsum(np.square(weighted[:, ch].astype(np.float64)), out=c[1:])
        total += gains[ch] * (c[hi] - c[lo]) / block
    return total


def lufs(x: np.ndarray, sr: int, block_size: float = 0.4, overlap: float = 0.75) -> float:
    """集成门控响度(ITU-R BS.1770-4),向量化实现。

    pyloudnorm 是同一套数学但在 Python 里逐 400ms 块循环,四分钟的歌要 ~30s;
    门控用累加和做,230s 的曲子一秒内测完。
    """
    x = np.asarray(x, dtype=np.float32)
    if x.ndim == 1:
        x = x[:, None]
    n, channels = x.shape

    weighted = Filter(k_weighting_sos(sr))(x, sr)
    gains = np.array([1.0, 1.0, 1.0, 1.41, 1.41])[:channels]

    block = int(round(block_size * sr))
    step_fraction = 1.0 - overlap
    if n < block:
        return -0.691 + 10.0 * np.log10(max(float(np.mean(np.square(weighted.astype(np.float64)) * gains)), EPS))

    num_blocks = int(round(((n / sr - block_size) / (block_size * step_fraction)))) + 1
    if num_blocks <= 1:
        return -0.691 + 10.0 * np.log10(max(float(np.mean(np.square(weighted.astype(np.float64)) * gains)), EPS))

    j = np.arange(num_blocks, dtype=np.float64)
    lo = (block_size * (j * step_fraction) * sr).astype(np.int64)
    hi = (block_size * (j * step_fraction + 1.0) * sr).astype(np.int64)
    np.clip(hi, 0, n, out=hi)

    power = _block_powers(weighted, sr, block, lo, hi, gains)
    loud = -0.691 + 10.0 * np.log10(np.maximum(power, EPS))

    above_absolute = loud > -70.0
    if not above_absolute.any():
        return -70.0

    relative = -0.691 + 10.0 * np.log10(max(float(np.mean(power[above_absolute])), EPS)) - 10.0
    gated = above_absolute & (loud > relative)
    if not gated.any():
        return -70.0

    return -0.691 + 10.0 * np.log10(max(float(np.mean(power[gated])), EPS))


def normalize_loudness(x: np.ndarray, sr: int, target_lufs: float, ceiling_db: float = -1.0) -> np.ndarray:
    ln10 = np.log(10.0) / 20.0
    measured = lufs(x, sr)
    delta = float(np.clip(target_lufs - measured, -24.0, 24.0))
    out = x * np.exp(delta * ln10)
    out = BrickwallLimiter(ceiling_db=ceiling_db, release_ms=120.0, lookahead_ms=5.0)(out, sr)

    # 第二遍:限制器会削掉一点,再校正一次
    err = target_lufs - lufs(out, sr)
    if abs(err) > 0.4:
        out = out * np.exp(np.clip(err, -6.0, 6.0) * ln10)
        out = BrickwallLimiter(ceiling_db=ceiling_db, release_ms=120.0, lookahead_ms=5.0)(out, sr)
    return out


def peak_db(x: np.ndarray) -> float:
    return 20.0 * np.log10(max(float(np.max(np.abs(x))), EPS))


def rms_db(x: np.ndarray) -> float:
    return 20.0 * np.log10(max(float(np.sqrt(np.mean(np.square(x)))), EPS))


# --------------------------------------------------------------------------
# 链构建
# --------------------------------------------------------------------------
def _vocal_eq(params: "Params", sr: int) -> Filter:
    sections = [highpass_sos(params.vocal_hp_hz, sr)]
    sections.append(peak_sos(params.mud_hz, 1.2, params.mud_db, sr))
    sections.append(peak_sos(params.mud2_hz, 1.0, params.mud2_db, sr))
    if params.warmth_db != 0.0:
        sections.append(low_shelf_sos(params.warmth_hz, params.warmth_db, sr))
    if params.presence_db != 0.0:
        sections.append(peak_sos(params.presence_hz, 0.8, params.presence_db, sr))
    if params.air_db != 0.0:
        sections.append(high_shelf_sos(params.air_hz, params.air_db, sr))
    return Filter(sections)


def _music_eq(params: "Params", sr: int) -> Filter:
    sections = [highpass_sos(params.music_hp_hz, sr)]
    if params.music_mud_db != 0.0:
        sections.append(peak_sos(320.0, 1.2, params.music_mud_db, sr))
    return Filter(sections)


def vocal_chain(params: "Params", sr: int) -> list:
    return [_vocal_eq(params, sr), Compressor(
        threshold_db=params.comp_threshold_db,
        ratio=params.comp_ratio,
        attack_ms=params.comp_attack_ms,
        release_ms=params.comp_release_ms,
    )]


def music_chain(params: "Params", sr: int) -> list:
    return [_music_eq(params, sr)]


def reverb(x: np.ndarray, sr: int, room: float, wet: float, damping: float) -> np.ndarray:
    if wet <= 0.0:
        return x
    wet_signal = Reverb(room_size=room, damping=damping, wet_level=1.0, dry_level=0.0)(x, sr)
    # 混响不要进浑浊的低频段,人声保持贴脸
    wet_signal = Filter([highpass_sos(250.0, sr)])(wet_signal, sr)
    dry = x * (1.0 - wet)
    return dry + wet_signal * wet


def add_doubling(x: np.ndarray, sr: int, level_db: float, delay_ms: float,
                 count: int = 3, detune: float = 0.0045,
                 block: int | None = None) -> np.ndarray:
    """在人声后面垫几层带限、微失谐的复制,做出"身体感"。

    一层 slap 只是回声;真正的厚度来自 ~20-45ms 的几个 double、彼此失谐零点几个
    百分比、并且缺低频——和三个录音室歌手在磁带上叠唱是同一件事。`level_db` 是
    每个 double 的电平,-60 = 关。
    """
    if level_db <= -60.0:
        return x
    n = x.shape[0]
    level = _linear_gain(level_db)
    doubles = band_filter(220.0, 7500.0, sr)(x, sr)
    out = x.copy()
    block = block or BLOCK
    fade = max(1, int(0.008 * sr))  # 8ms:别让尾巴停在台阶上

    multipliers = (0.72, 1.0, 1.45)[:count]
    detunes = (-detune, detune * 0.9, -detune * 1.7)[:count]
    for mul, scale in zip(multipliers, detunes):
        scale = 1.0 + scale
        delay = int(round(delay_ms * mul / 1000.0 * sr))
        if delay <= 0 or delay >= n:
            continue
        # 失谐副本会稍微读到自身位置之后,信号走完前它先没源了;在那里停下而不是
        # 保持最后一个采样
        span = min(n - delay, int((n - 1) / scale) + 1)
        if span <= 0:
            continue
        tail = span - min(fade, span // 2)
        for i in range(0, span, block):
            j = min(i + block, span)
            lo = max(0, int(i * scale) - 1)
            hi = min(n, int(j * scale) + 2)
            idx = np.arange(i, j, dtype=np.float64) * scale
            src = np.arange(lo, hi, dtype=np.float64)
            for ch in range(x.shape[1]):
                shifted = np.interp(idx, src, doubles[lo:hi, ch])
                if j > tail:
                    k = max(0, tail - i)
                    shifted[k:] *= np.linspace(1.0, 0.0, len(shifted) - k)
                out[i + delay:j + delay, ch] += shifted * level
    return out.astype(np.float32, copy=False)


# --------------------------------------------------------------------------
# 预设
# --------------------------------------------------------------------------
@dataclass
class Params:
    # ---- 全局 ----
    target_lufs: float = -14.0
    declip_knee: float = 0.94

    # ---- 人声 ----
    vocal_gain_db: float = 0.0
    vocal_hp_hz: float = 40.0
    mud_hz: float = 320.0
    mud_db: float = -3.0
    mud2_hz: float = 470.0
    mud2_db: float = -2.0
    warmth_hz: float = 180.0
    warmth_db: float = 1.0
    presence_hz: float = 2500.0
    presence_db: float = 3.0
    air_hz: float = 8000.0
    air_db: float = 2.0

    # ---- de-esser(两段)----
    deesser_hz: float = 6500.0
    deesser_hz2: float = 9200.0
    deesser_offset_db: float = -5.0  # 阈值 = 人声核心电平 + 这个偏移
    deesser_amount: float = 0.8

    # ---- 人声动态 ----
    comp_threshold_db: float = -20.0
    comp_ratio: float = 1.6
    comp_attack_ms: float = 20.0
    comp_release_ms: float = 120.0

    # ---- 人声空间 ----
    # 混响默认关:混音里本来就自带空间,再叠混响就是"回响太重"。加厚默认开——
    # 带限微失谐的 double 是身体感,不是效果。
    reverb_room: float = 0.45
    reverb_wet: float = 0.0
    reverb_damping: float = 0.4
    doubling_db: float = -18.0  # 每个 double 的电平;-60 = 关
    doubling_ms: float = 25.0

    # ---- 编排 / 伴奏 ----
    music_gain_db: float = -1.0
    music_hp_hz: float = 30.0
    music_mud_db: float = -2.0
    duck_db: float = 4.0
    duck_lo_hz: float = 250.0
    duck_hi_hz: float = 4000.0
    duck_threshold_db: float = -28.0
    duck_attack_ms: float = 40.0
    duck_release_ms: float = 260.0

    def to_dict(self) -> dict:
        return asdict(self)

    @staticmethod
    def from_dict(values: dict) -> "Params":
        return Params(**{k: v for k, v in values.items() if k in Params.__dataclass_fields__})


PRESETS: dict[str, Params] = {
    # 没有预设加混响。加厚按风格调:主唱该有多少身体感。-60 = 关。
    "中性 (只修问题)": Params(
        vocal_gain_db=0.0, mud_db=-2.5, presence_db=2.0, air_db=1.5,
        deesser_amount=0.7, comp_ratio=1.3, duck_db=3.0, doubling_db=-20.0,
    ),
    "中文流行": Params(
        vocal_gain_db=+1.0, mud_db=-3.5, mud2_db=-2.5, warmth_db=1.2,
        presence_db=3.2, air_db=2.2, deesser_amount=0.9, comp_ratio=1.7,
        duck_db=4.5, music_gain_db=-1.5, doubling_db=-18.0,
    ),
    "K-pop ballad": Params(
        vocal_gain_db=+1.5, mud_db=-4.0, warmth_db=1.5, presence_db=2.8,
        air_db=2.6, deesser_amount=1.0, deesser_offset_db=-4.0, comp_ratio=1.9,
        reverb_room=0.55, duck_db=5.0, music_gain_db=-2.0, doubling_db=-16.0,
    ),
    "EDM / 电子流行": Params(
        vocal_gain_db=+0.8, vocal_hp_hz=60.0, mud_db=-4.0, warmth_db=0.0,
        presence_db=3.6, air_db=2.8, deesser_amount=1.1, deesser_offset_db=-4.0,
        comp_ratio=2.2, comp_attack_ms=12.0, reverb_room=0.3,
        duck_db=6.0, music_gain_db=0.0, music_hp_hz=25.0, doubling_db=-15.0,
    ),
    "Rock": Params(
        vocal_gain_db=+0.5, mud_db=-3.0, warmth_db=1.8, presence_db=3.4,
        air_db=1.6, deesser_amount=0.8, comp_ratio=2.0, reverb_room=0.35,
        duck_db=3.5, music_gain_db=+0.5, doubling_db=-18.0, doubling_ms=18.0,
    ),
    "Lo-fi / 氛围": Params(
        vocal_gain_db=0.0, mud_db=-2.0, warmth_db=2.2, presence_db=2.0,
        air_db=1.0, deesser_amount=0.6, deesser_offset_db=-7.0, comp_ratio=1.4,
        reverb_room=0.6, duck_db=3.0, music_gain_db=-0.5,
        target_lufs=-16.0, doubling_db=-22.0, doubling_ms=35.0,
    ),
    "美式流行": Params(
        vocal_gain_db=+1.2, mud_db=-3.8, warmth_db=0.8, presence_db=3.5,
        air_db=2.4, deesser_amount=1.0, comp_ratio=1.8, reverb_room=0.42,
        duck_db=5.0, music_gain_db=-1.0, doubling_db=-17.0,
    ),
}


def preset_names() -> list[str]:
    return list(PRESETS.keys())

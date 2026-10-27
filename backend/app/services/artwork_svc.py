"""Procedural cover art: hash-derived gradient + the song's real waveform + title."""

import colorsys
import hashlib

import numpy as np

from ..core.config import ROOT

FONT_CANDIDATES = [
    (str(ROOT / "assets" / "fonts" / "yanbo-song-bold.ttf"), {}),
    ("/home/feifei/.fonts/猫啃网烟波宋-B.ttf", {}),
    ("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", {"index": 2}),
    ("/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf", {}),
]


def _load_font(size: int):
    from PIL import ImageFont

    for path, kwargs in FONT_CANDIDATES:
        try:
            font = ImageFont.truetype(path, size, **kwargs)
            if font.getbbox("夜")[2] > 0:  # must actually render CJK
                return font, path
        except Exception:
            continue
    return ImageFont.load_default(), "default"


def _waveform(audio_path: str, n_bars: int = 96) -> list[float]:
    import soundfile as sf

    data, _ = sf.read(audio_path, dtype="float32")
    if data.ndim > 1:
        data = data.mean(axis=1)
    n = len(data)
    step = max(1, n // n_bars)
    amps = []
    for i in range(n_bars):
        seg = data[i * step : (i + 1) * step]
        amps.append(float(np.abs(seg).max()) if len(seg) else 0.0)
    peak = max(amps) or 1.0
    return [min(1.0, a / peak) for a in amps]


def _gradient(w: int, h: int, top: tuple, bottom: tuple) -> np.ndarray:
    t = np.linspace(0.0, 1.0, h)[:, None, None]
    top_a = np.array(top, dtype=np.float32)[None, None, :]
    bot_a = np.array(bottom, dtype=np.float32)[None, None, :]
    arr = top_a * (1 - t) + bot_a * t
    return np.repeat(arr, w, axis=1)


def generate_cover(out_path, title: str, subtitle: str, audio_path: str | None = None, seed: int = 0) -> None:
    """Deterministic per (title, seed). 1024x1024 PNG."""
    from PIL import Image, ImageDraw, ImageFilter

    W = H = 1024
    h0 = hashlib.sha256(f"{title}|{seed}".encode()).digest()
    hue = h0[0] / 255.0
    hue2 = (hue + 0.12 + h0[1] / 1275.0) % 1.0
    c_bg_top = tuple(int(c * 255) for c in colorsys.hsv_to_rgb(hue, 0.45, 0.16))
    c_bg_bot = tuple(int(c * 255) for c in colorsys.hsv_to_rgb(hue2, 0.55, 0.34))
    accent = tuple(int(c * 255) for c in colorsys.hsv_to_rgb(hue2, 0.62, 0.92))

    img = Image.fromarray(_gradient(W, H, c_bg_top, c_bg_bot).astype(np.uint8))
    draw = ImageDraw.Draw(img, "RGBA")

    # soft radial glow behind the waveform
    glow = Image.new("L", (W, H), 0)
    gdraw = ImageDraw.Draw(glow)
    gdraw.ellipse([W * 0.05, H * 0.28, W * 0.95, H * 0.72], fill=70)
    glow = glow.filter(ImageFilter.GaussianBlur(120))
    overlay = Image.new("RGB", (W, H), accent)
    img = Image.composite(overlay, img, glow)
    draw = ImageDraw.Draw(img, "RGBA")

    # waveform bars, mirrored around the center line
    if audio_path:
        amps = _waveform(audio_path)
        bar_w = W * 0.84 / len(amps)
        x0 = W * 0.08
        max_h = H * 0.24
        for i, a in enumerate(amps):
            h = max(3.0, a * max_h)
            x = x0 + i * bar_w
            alpha = 140 + int(90 * a)
            draw.rounded_rectangle(
                [x, H / 2 - h, x + bar_w * 0.62, H / 2 + h],
                radius=bar_w * 0.3,
                fill=(*accent, alpha),
            )
        draw.line([W * 0.08, H / 2, W * 0.92, H / 2], fill=(*accent, 90), width=2)

    # typography
    font_big, _ = _load_font(76)
    font_small, _ = _load_font(30)
    # wrap title to at most 2 lines of 9 chars
    clean = title.strip() or "未命名"
    lines = [clean[i : i + 9] for i in range(0, len(clean), 9)][:2]
    y = H - 200 - (len(lines) - 1) * 92
    for ln in lines:
        draw.text((72, y), ln, font=font_big, fill=(245, 245, 245, 255))
        y += 92
    sub = subtitle if len(subtitle) <= 44 else subtitle[:43] + "…"
    draw.text((76, H - 96), sub, font=font_small, fill=(210, 210, 210, 220))

    img.save(out_path, "PNG")

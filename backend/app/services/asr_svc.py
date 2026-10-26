"""Qwen3-ASR lyrics transcription service."""

from difflib import SequenceMatcher


def _is_cjk(ch: str) -> bool:
    return 0x2E80 <= ord(ch) <= 0x9FFF or 0xF900 <= ord(ch) <= 0xFAFF


def _join_tokens(tokens: list[str]) -> str:
    out = ""
    for t in tokens:
        if out and not _is_cjk(out[-1]) and not _is_cjk(t[0]) and (out[-1].isalnum() or out[-1] in ",'") and (t[0].isalnum() or t[0] in "'"):
            out += " "
        out += t
    return out


def _items_to_lines(items: list[dict], gap: float = 0.6) -> list[dict]:
    """Group aligned tokens into lyric lines on time gaps (breath pauses)."""
    lines: list[dict] = []
    cur: list[dict] = []

    def flush():
        if not cur:
            return
        text = _join_tokens([t["text"] for t in cur]).strip()
        if text:
            lines.append({
                "start": round(cur[0]["start"], 2),
                "end": round(cur[-1]["end"], 2),
                "text": text,
            })
        cur.clear()

    for it in items:
        if cur and it["start"] - cur[-1]["end"] > gap:
            flush()
        cur.append(it)
    flush()
    return lines


def _fmt_lrc_time(t: float) -> str:
    m = int(t // 60)
    return f"{m:02d}:{t - m * 60:05.2f}"


def build_lrc(segments: list[dict], title: str = "") -> str:
    head = [f"[ti:{title}]"] if title else []
    body = [f"[{_fmt_lrc_time(seg['start'])}]{seg['text']}" for seg in segments]
    return "\n".join(head + body)


def _clean_text(s: str) -> str:
    return "".join(ch for ch in s if _is_cjk(ch) or ch.isalnum())


def align_reference_lines(ref: str, items: list[dict]) -> list[dict]:
    """Timestamp the user's own lyric lines by fuzzy-matching them onto the
    ASR-aligned character timeline (ASR of sung vocals is imperfect; the
    reference lyrics are what should end up in the LRC)."""
    if not items or not ref.strip():
        return []
    # char timeline: one entry per ASR-aligned character
    timeline: list[tuple[str, float, float]] = []
    for it in items:
        for ch in it["text"]:
            timeline.append((ch, it["start"], it["end"]))
    asr_clean = _clean_text("".join(c for c, _, _ in timeline))
    # timeline index per asr_clean char
    idx_map = [i for i, (c, _, _) in enumerate(timeline) if _is_cjk(c) or c.isalnum()]
    if len(idx_map) != len(asr_clean):
        return []

    ref_clean = _clean_text(ref)
    sm = SequenceMatcher(None, asr_clean, ref_clean, autojunk=False)
    ref_time: list[float | None] = [None] * len(ref_clean)
    for a1, b1, size in sm.get_matching_blocks():
        for k in range(size):
            t = timeline[idx_map[a1 + k]][1]
            if ref_time[b1 + k] is None:
                ref_time[b1 + k] = t
    # interpolate unmatched ref chars: trailing ones take the previous match,
    # leading ones take the next match
    last: float | None = None
    for i in range(len(ref_time)):
        if ref_time[i] is not None:
            last = ref_time[i]
        elif last is not None:
            ref_time[i] = last
    nxt: float | None = None
    for i in range(len(ref_time) - 1, -1, -1):
        if ref_time[i] is not None:
            nxt = ref_time[i]
        elif nxt is not None:
            ref_time[i] = nxt
    if any(t is None for t in ref_time):
        return []  # alignment failed entirely; caller falls back to ASR lines

    # walk the original ref lines, timing each by its cleaned char span
    lines: list[dict] = []
    pos = 0
    for raw in ref.split("\n"):
        stripped = raw.strip()
        if not stripped or (stripped.startswith("[") and stripped.endswith("]")):
            continue
        n = len(_clean_text(stripped))
        chars = ref_time[pos : pos + n]
        pos += n
        if not chars:
            continue
        lines.append({"start": round(min(chars), 2), "end": round(max(chars), 2), "text": stripped})
    return lines


def transcribe_lyrics(
    src: str, emit=None, language: str | None = None, with_timestamps: bool = True
) -> dict:
    """Transcribe singing vocals. With timestamps, also returns the token-level
    alignment grouped into lyric lines (for LRC)."""
    from .models_mgr import models

    emit = emit or (lambda **e: None)
    emit(stage="asr", detail="loading Qwen3-ASR")
    model = models.asr()
    emit(stage="asr", detail="transcribing vocals")
    results = model.transcribe(audio=src, language=language, return_time_stamps=with_timestamps)
    r = results[0]
    out: dict = {"text": (r.text or "").strip(), "language": getattr(r, "language", None)}
    if with_timestamps:
        items: list[dict] = []
        ts = getattr(r, "time_stamps", None)
        for it in (getattr(ts, "items", None) or []):
            text = str(getattr(it, "text", "")).strip()
            if text:
                items.append({
                    "text": text,
                    "start": float(getattr(it, "start_time", 0)),
                    "end": float(getattr(it, "end_time", 0)),
                })
        out["items"] = items
        out["segments"] = _items_to_lines(items)
    return out

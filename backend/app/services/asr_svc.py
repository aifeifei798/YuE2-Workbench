"""Qwen3-ASR lyrics transcription service."""

from .models_mgr import models


def transcribe_lyrics(src: str, emit=None, language: str | None = None) -> dict:
    """Transcribe singing vocals to raw lyrics text."""
    emit = emit or (lambda **e: None)
    emit(stage="asr", detail="loading Qwen3-ASR")
    model = models.asr()
    emit(stage="asr", detail="transcribing vocals")
    results = model.transcribe(audio=src, language=language)
    r = results[0]
    text = (r.text or "").strip()
    return {"text": text, "language": getattr(r, "language", None)}

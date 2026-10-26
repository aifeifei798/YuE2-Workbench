"""SheetSage2 transcription service."""

import json
import os
import shutil
from pathlib import Path

from ..core.config import settings
from .models_mgr import models

TRANSCRIPTION_FILES = [
    "score.abc",
    "transcription.mid",
    "melody_vocal.mid",
    "melody_instrumental.mid",
    "chords.mid",
    "events.json",
    "key.lab",
    "beat.lab",
    "downbeat.lab",
    "chord.lab",
    "structure.lab",
]


def transcribe_file(src: str, out_dir: Path, melody_only: bool = False, emit=None) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    emit = emit or (lambda **e: None)
    emit(stage="load_model", detail="loading SheetSage2")
    model = models.sheetsage()
    emit(stage="transcribe", detail=f"transcribing {os.path.basename(src)}")
    result = model.transcribe(src, output_dir=str(out_dir), melody_only=melody_only)

    abc = result["abc"]
    files = {}
    for name in TRANSCRIPTION_FILES:
        p = out_dir / name
        if p.exists():
            files[name] = "/audio/" + os.path.relpath(p, settings.data_dir)
    events = []
    events_path = out_dir / "events.json"
    if events_path.exists():
        try:
            data = json.loads(events_path.read_text(encoding="utf-8"))
            events = data.get("events", []) if isinstance(data, dict) else data
        except Exception:
            events = []

    summary = summarize(events)
    return {
        "abc": abc,
        "melody_only": melody_only,
        "dir": str(out_dir),
        "files": files,
        "summary": summary,
    }


def summarize(events: list) -> dict:
    """Compact info from decoded events: keys, chords, tempo, structure, duration."""
    keys, chords, structures, stamps = [], [], [], []
    last_key = last_chord = last_struct = None
    duration = 0.0
    for ev in events:
        vals = ev.get("values", {}) if isinstance(ev, dict) else {}
        t = vals.get("timestamp", ev.get("time") if isinstance(ev, dict) else 0) or 0
        duration = max(duration, float(t))
        if "key" in vals and vals["key"] != last_key:
            keys.append({"t": round(float(t), 2), "key": vals["key"]})
            last_key = vals["key"]
        if "chord" in vals and vals["chord"] != last_chord:
            chords.append(vals["chord"])
            last_chord = vals["chord"]
        if "structure" in vals and vals["structure"] != last_struct:
            structures.append({"t": round(float(t), 2), "label": vals["structure"]})
            last_struct = vals["structure"]
        rhythm = vals.get("rhythm") or {}
        if "timestamp" in vals and "eighth_position" in rhythm:
            stamps.append((float(t), int(rhythm["eighth_position"])))

    tempo = None
    ratios = [
        (b - a) / (pb - pa)
        for (a, pa), (b, pb) in zip(stamps, stamps[1:])
        if pb > pa and b > a
    ]
    if ratios:
        ratios.sort()
        eighth = ratios[len(ratios) // 2]
        if eighth > 0:
            tempo = round(60.0 / (eighth * 2), 1)
    return {
        "keys": keys,
        "n_chords": len(chords),
        "chords_head": chords[:32],
        "tempo": tempo,
        "structures": structures,
        "duration": duration,
    }


def transcribe_version(version_row, melody_only: bool = False, emit=None) -> dict:
    """Transcribe a generated version's audio into its own folder."""
    audio_path = version_row.audio_path
    if not audio_path or not Path(audio_path).exists():
        raise ValueError("version has no rendered audio")
    vdir = Path(audio_path).parent
    out_dir = vdir / "transcription"
    return transcribe_file(audio_path, out_dir, melody_only=melody_only, emit=emit)


def load_beats(version) -> dict:
    """Beat/downbeat times from a version's transcription (if present)."""
    vdir = Path(version.audio_path).parent
    tdir = vdir / "transcription"
    out = {"beats": [], "downbeats": []}
    beat_file = tdir / "beat.lab"
    down_file = tdir / "downbeat.lab"
    if beat_file.exists():
        out["beats"] = [float(ln.split()[0]) for ln in beat_file.read_text().splitlines() if ln.strip()]
    if down_file.exists():
        out["downbeats"] = [float(ln.split()[0]) for ln in down_file.read_text().splitlines() if ln.strip()]
    return out

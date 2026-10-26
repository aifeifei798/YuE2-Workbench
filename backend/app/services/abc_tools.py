"""Deterministic ABC transforms used by the score-editing agent.

The LLM only picks tools and parameters; these functions do the actual,
reliable editing (transpose / reharmonize / set_tempo).
"""

import re

# natural pitch classes
_LETTER_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
# spelling preference (sharps)
_PC_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
_PC_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]

_NOTE_RE = re.compile(r"([_^=]{1,2})?([a-gA-G])(,+)?('+)?")
_CHORD_RE = re.compile(r'"([A-G][#b]?)([^"/]*)(/([A-G][#b]?))?([^"]*)"')
_KEY_RE = re.compile(r"K:([A-G])([#b]?)")


def _accidental_semitones(acc: str) -> int:
    if not acc:
        return 0
    return acc.count("^") - acc.count("_")


def _spell(pc: int, prefer: str) -> tuple[str, int]:
    """Pitch class -> (natural letter, accidental string)."""
    pc %= 12
    table = _PC_SHARP if prefer != "flat" else _PC_FLAT
    name = table[pc]
    letter, acc = name[0], name[1:]
    return letter, acc


def _transpose_note_token(m: re.Match, semis: int, prefer: str) -> str:
    acc, letter, commas, quotes = m.group(1) or "", m.group(2), m.group(3) or "", m.group(4) or ""
    pc = _LETTER_PC[letter.upper()] + _accidental_semitones(acc)
    octave = len(quotes) - len(commas) + (1 if letter.islower() else 0)
    midi = 60 + octave * 12 + pc + semis
    new_pc = midi % 12
    new_octave = (midi - 60) // 12
    L, new_acc = _spell(new_pc, prefer)
    if new_octave == 1:
        return new_acc + L.lower()
    if new_octave >= 2:
        return new_acc + L.lower() + "'" * (new_octave - 1)
    if new_octave == 0:
        return new_acc + L.upper()
    return new_acc + L.upper() + "," * (-new_octave)


def _transpose_chord_root(root: str, semis: int, prefer: str) -> str:
    letter = root[0]
    acc = root[1:]
    pc = _LETTER_PC[letter] + (1 if "#" in acc else 0) - (1 if "b" in acc else 0)
    L, new_acc = _spell(pc + semis, prefer)
    return L + new_acc


def transpose(abc: str, semitones: int) -> str:
    semis = int(semitones)
    if not -11 <= semis <= 11 or semis == 0:
        raise ValueError("semitones must be in -11..11 and nonzero")
    prefer = "sharp" if semis > 0 else "flat"

    def sub_note(m: re.Match) -> str:
        # skip bar/other syntax: only pure note tokens match the regex anyway
        return _transpose_note_token(m, semis, prefer)

    def sub_chord(m: re.Match) -> str:
        root, quality, bass = m.group(1), m.group(2), m.group(4)
        new_root = _transpose_chord_root(root, semis, prefer)
        new_bass = _transpose_chord_root(bass, semis, prefer) if bass else ""
        slash = f"/{new_bass}" if bass else ""
        tail = m.group(5) or ""
        return f'"{new_root}{quality}{slash}{tail}"'

    def sub_key(m: re.Match) -> str:
        letter, acc = m.group(1), m.group(2)
        pc = _LETTER_PC[letter] + (1 if acc == "#" else 0) - (1 if acc == "b" else 0)
        L, new_acc = _spell(pc + semis, prefer)
        return f"K:{L}{new_acc}"

    out_lines = []
    in_body = False
    for line in abc.splitlines():
        if line.startswith("K:"):
            in_body = True
            out_lines.append(_KEY_RE.sub(sub_key, line))
            continue
        if not in_body or line.strip().startswith("%"):
            out_lines.append(line)
            continue
        if re.match(r"^[A-Za-z]:", line):
            # ABC information field (V:, M:, L:, s:, w:, %% ...) — never rewrite
            out_lines.append(line)
            continue
        line = _CHORD_RE.sub(sub_chord, line)
        # transpose notes but not inside chord quotes: remove chords, transform, restore
        chords: list[str] = []
        def stash(cm: re.Match) -> str:
            chords.append(cm.group(0))
            return f"\x00{len(chords) - 1}\x00"
        line = _CHORD_RE.sub(stash, line)
        line = _NOTE_RE.sub(sub_note, line)
        line = re.sub(r"\x00(\d+)\x00", lambda mm: chords[int(mm.group(1))], line)
        out_lines.append(line)
    return "\n".join(out_lines)


_REHARM_MAP = {
    "": "maj7", "maj": "maj7", "maj7": "maj9", "M7": "maj9",
    "m": "m7", "min": "m7", "m7": "m9", "Min7": "m9",
    "7": "9", "9": "13", "sus4": "sus9", "dim": "m7b5",
}


def reharmonize(abc: str) -> str:
    """Jazz-flavored color: maj->maj7, m->m7, 7->9, etc. Bass notes preserved."""

    def sub(m: re.Match) -> str:
        root, quality, bass = m.group(1), m.group(2), m.group(4)
        new_q = _REHARM_MAP.get(quality, quality)
        bass_part = f"/{m.group(4)}" if bass else ""
        tail = m.group(5) or ""
        return f'"{root}{new_q}{bass_part}{tail}"'

    return _CHORD_RE.sub(sub, abc)


def set_tempo(abc: str, bpm: int) -> str:
    bpm = int(bpm)
    if not 40 <= bpm <= 240:
        raise ValueError("bpm must be 40..240")
    lines = abc.splitlines()
    replaced = False
    for i, line in enumerate(lines):
        if line.strip().upper().startswith("Q:"):
            lines[i] = f"Q:1/4={bpm}"
            replaced = True
            break
    if not replaced:
        for i, line in enumerate(lines):
            if line.startswith("K:"):
                lines.insert(i + 1, f"Q:1/4={bpm}")
                replaced = True
                break
    if not replaced:
        lines.append(f"Q:1/4={bpm}")
    return "\n".join(lines)


def score_info(abc: str) -> dict:
    tempo = None
    keys = _KEY_RE.findall(abc)
    m = re.search(r"Q:1/4=(\d+)", abc)
    if m:
        tempo = int(m.group(1))
    n_chords = len(_CHORD_RE.findall(abc))
    return {"key": (keys[0] if keys else None), "tempo": tempo, "n_chords": n_chords}


TOOL_SPECS = {
    "transpose": {"semitones": int},
    "reharmonize": {},
    "set_tempo": {"bpm": int},
}

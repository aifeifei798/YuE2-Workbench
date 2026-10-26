"""Score-editing agent: a small local LLM selects deterministic ABC tools."""

import json
import re
import time
from pathlib import Path

import torch

from ..core.config import settings
from . import abc_tools
from .models_mgr import models

SYSTEM_PROMPT = """You are a music score editing agent. You edit ABC lead sheets by calling tools.
Available tools:
- transpose(semitones: int): transpose all notes/chords/key, -11..11, nonzero.
- reharmonize(): jazzify chord colors (C->Cmaj7, Am->Am7, G7->G9). Takes NO arguments.
- set_tempo(bpm: int): set tempo 40..240.
Semitone conversion: 1 whole tone (全音/大二度/一个key in pop speech) = 2 semitones; 半音 = 1; 一个八度 = 12 (do NOT use 12 for 全音).
Examples:
"升高一个全音" -> [{"tool": "transpose", "args": {"semitones": 2}}]
"降半个key" -> [{"tool": "transpose", "args": {"semitones": -1}}]
"升3个半音" -> [{"tool": "transpose", "args": {"semitones": 3}}]
"加爵士七和弦" -> [{"tool": "reharmonize", "args": {}}]
"速度改成110" -> [{"tool": "set_tempo", "args": {"bpm": 110}}]
Respond ONLY with a JSON array of steps. No prose, no markdown."""


def _llm_generate(instruction: str, info: dict) -> list[dict]:
    tok, model = models.agent_llm()
    user = (
        f"Current score: key={info.get('key')}, tempo={info.get('tempo')}, chords={info.get('n_chords')}.\n"
        f"User instruction: {instruction}\nJSON steps:"
    )
    prompt = tok.apply_chat_template(
        [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": user}],
        tokenize=False, add_generation_prompt=True, enable_thinking=False,
    )
    inputs = tok(prompt, return_tensors="pt").to(model.device)
    with torch.inference_mode():
        out = model.generate(**inputs, max_new_tokens=220, do_sample=False,
                             pad_token_id=tok.pad_token_id or tok.eos_token_id)
    text = tok.decode(out[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True)
    return _parse_steps(text)


def _parse_steps(text: str) -> list[dict]:
    m = re.search(r"\[.*\]", text, re.S)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            pass
    m = re.search(r"\{.*\}", text, re.S)
    if m:
        try:
            return [json.loads(m.group(0))]
        except Exception:
            pass
    raise ValueError(f"无法解析模型输出为工具调用: {text[:120]}")


def agent_history(version) -> list[dict]:
    vdir = Path(version.audio_path).parent if version.audio_path else None
    hist_path = vdir / "edits" / "agent_history.json" if vdir else None
    if hist_path and hist_path.exists():
        try:
            return json.loads(hist_path.read_text(encoding="utf-8"))
        except Exception:
            return []
    return []


def save_draft(version, abc: str, note: str = "") -> dict:
    vdir = Path(version.audio_path).parent
    edits = vdir / "edits"
    edits.mkdir(parents=True, exist_ok=True)
    draft = {"abc": abc, "note": note, "updated_at": time.time()}
    (edits / "draft.json").write_text(json.dumps(draft, ensure_ascii=False, indent=1), encoding="utf-8")
    return draft


def edit_score(version, instruction: str, emit) -> dict:
    """Plan tool steps via LLM, apply to the version's ABC, return proposal + diff."""
    import difflib

    emit = emit or (lambda **e: None)
    vdir = Path(version.audio_path).parent
    abc = version.abc or (vdir / "plan.abc").read_text(encoding="utf-8")
    if not abc.strip():
        raise ValueError("version has no ABC score to edit")
    info = abc_tools.score_info(abc)

    emit(stage="agent", detail="understanding instruction")
    steps = _llm_generate(instruction, info)

    proposed = abc
    applied = []
    for step in steps[:4]:
        tool = step.get("tool")
        args = step.get("args") or {}
        if tool not in abc_tools.TOOL_SPECS:
            raise ValueError(f"未知工具: {tool}")
        emit(stage="agent", detail=f"applying {tool}")
        if tool == "transpose":
            proposed = abc_tools.transpose(proposed, args.get("semitones", 0))
        elif tool == "reharmonize":
            proposed = abc_tools.reharmonize(proposed)
        elif tool == "set_tempo":
            proposed = abc_tools.set_tempo(proposed, args.get("bpm", 0))
        applied.append({"tool": tool, "args": args})

    diff = "\n".join(
        difflib.unified_diff(abc.splitlines(), proposed.splitlines(), "original", "proposed", lineterm="", n=1)
    )
    record = {
        "t": time.time(),
        "instruction": instruction,
        "steps": applied,
        "info_before": info,
        "info_after": abc_tools.score_info(proposed),
    }
    try:
        vdir.mkdir(parents=True, exist_ok=True)
        hist_path = vdir / "edits" / "agent_history.json"
        hist = json.loads(hist_path.read_text(encoding="utf-8")) if hist_path.exists() else []
        hist.append(record)
        hist_path.write_text(json.dumps(hist, ensure_ascii=False, indent=1), encoding="utf-8")
    except Exception:
        pass
    return {
        "instruction": instruction,
        "steps": applied,
        "original_abc": abc,
        "proposed_abc": proposed,
        "diff": diff,
        "info_before": info,
        "info_after": abc_tools.score_info(proposed),
    }

"""Ollama tool-calling client."""
from __future__ import annotations

import json
import os
from typing import Any

import httpx

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
MODEL = os.environ.get("VOICECTRL_MODEL", "qwen2.5:7b-instruct")

SYSTEM_PROMPT = (
    "You are VoiceCtrl, a real-time voice assistant for Ableton Live.\n"
    "The user speaks musical instructions in any language. Translate each "
    "instruction into one or more Ableton commands by calling the provided "
    "tools.\n"
    "Rules:\n"
    "- Track and scene indexing starts at 0 (track 1 = index 0).\n"
    "- Volumes are in dB. 0 dB is unity, -inf is silent.\n"
    "- If the user refers to a track by name, first call get_session_info to "
    "  resolve the name to an index, then call the action.\n"
    "- Be decisive: prefer one tool call. Never ask follow-up questions.\n"
    "- If no tool fits, briefly explain in plain text without calling tools."
)


async def plan(transcript: str, tools: list[dict]) -> dict[str, Any]:
    """Ask the LLM to translate a transcript into tool calls.

    Returns the raw Ollama /api/chat response (dict).
    """
    body = {
        "model": MODEL,
        "stream": False,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user",   "content": transcript},
        ],
        "tools": tools,
        "options": {"temperature": 0.1},
    }
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(f"{OLLAMA_URL}/api/chat", json=body)
        r.raise_for_status()
        return r.json()


def extract_tool_calls(resp: dict[str, Any]) -> list[dict[str, Any]]:
    """Pull out tool calls from an Ollama chat response.

    Ollama returns ``{"message": {"tool_calls": [{"function": {"name", "arguments"}}]}}``
    Arguments are usually already a dict but can be a JSON string.
    """
    msg = resp.get("message", {})
    raw_calls = msg.get("tool_calls") or []
    out: list[dict[str, Any]] = []
    for c in raw_calls:
        fn = c.get("function", {})
        name = fn.get("name")
        args = fn.get("arguments")
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except ValueError:
                args = {}
        if name:
            out.append({"name": name, "arguments": args or {}})
    return out

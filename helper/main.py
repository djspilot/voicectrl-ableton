"""VoiceCtrl FastAPI helper.

Endpoints:
    GET  /              → web UI (jweb / browser)
    GET  /status        → health check (Ollama + Ableton)
    POST /listen        → upload audio (form-field "audio") → transcript+actions
    POST /command       → JSON {"text": "..."} → actions (skip STT)
"""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import ableton, llm, stt
from .tools import COMMAND_MAP, TOOLS

log = logging.getLogger("voicectrl")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

ROOT = Path(__file__).resolve().parent.parent
WEB  = ROOT / "web"

app = FastAPI(title="VoiceCtrl")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # local-only server, M4L jweb sends from null origin
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory=str(WEB)), name="static")


class TextCommand(BaseModel):
    text: str


@app.get("/")
async def root() -> FileResponse:
    return FileResponse(WEB / "index.html")


@app.get("/status")
async def status() -> dict[str, Any]:
    return {
        "ableton": ableton.health_check(),
        "model":   llm.MODEL,
        "ollama":  llm.OLLAMA_URL,
    }


async def _execute(transcript: str) -> dict[str, Any]:
    """Plan with the LLM, execute every tool call against Ableton."""
    log.info("transcript: %r", transcript)
    resp = await llm.plan(transcript, TOOLS)
    calls = llm.extract_tool_calls(resp)

    if not calls:
        text = (resp.get("message") or {}).get("content", "").strip()
        log.info("no tool calls; assistant said: %s", text)
        return {"transcript": transcript, "actions": [], "assistant": text}

    actions: list[dict[str, Any]] = []
    for call in calls:
        name = call["name"]
        args = call["arguments"]
        translator = COMMAND_MAP.get(name)
        if not translator:
            actions.append({"tool": name, "args": args, "error": "unknown tool"})
            continue
        try:
            cmd_type, params = translator(args)
            log.info("→ ableton %s %s", cmd_type, params)
            result = await asyncio.to_thread(ableton.send_command, cmd_type, params)
            actions.append({"tool": name, "args": args, "ableton": result})
        except Exception as e:           # noqa: BLE001
            log.exception("tool %s failed", name)
            actions.append({"tool": name, "args": args, "error": str(e)})

    return {"transcript": transcript, "actions": actions}


@app.post("/listen")
async def listen(audio: UploadFile = File(...)) -> JSONResponse:
    blob = await audio.read()
    if not blob:
        raise HTTPException(400, "empty audio upload")
    try:
        transcript = await stt.transcribe(blob)
    except stt.STTError as e:
        raise HTTPException(500, f"STT failed: {e}") from e
    if not transcript:
        return JSONResponse({"transcript": "", "actions": [], "assistant": "(no speech detected)"})
    return JSONResponse(await _execute(transcript))


@app.post("/command")
async def command(cmd: TextCommand) -> JSONResponse:
    return JSONResponse(await _execute(cmd.text))

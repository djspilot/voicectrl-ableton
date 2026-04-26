"""Speech-to-text via whisper.cpp (whisper-cli)."""
from __future__ import annotations

import asyncio
import os
import shutil
import tempfile
from pathlib import Path

WHISPER_CLI = shutil.which("whisper-cli") or "/opt/homebrew/bin/whisper-cli"
FFMPEG     = shutil.which("ffmpeg")     or "/opt/homebrew/bin/ffmpeg"
MODEL_PATH = Path(__file__).resolve().parent.parent / "models" / "ggml-base.en.bin"


class STTError(RuntimeError):
    pass


async def transcribe(audio_bytes: bytes, language: str = "auto") -> str:
    """Transcribe a chunk of audio (any common container ffmpeg understands).

    1. write to temp file
    2. ffmpeg -> 16k mono wav
    3. whisper-cli on the wav, return text
    """
    if not MODEL_PATH.exists():
        raise STTError(f"whisper model not found at {MODEL_PATH}")

    with tempfile.TemporaryDirectory() as td:
        in_path  = Path(td) / "in.bin"
        wav_path = Path(td) / "in.wav"
        in_path.write_bytes(audio_bytes)

        # ffmpeg → 16k mono wav
        proc = await asyncio.create_subprocess_exec(
            FFMPEG, "-y", "-loglevel", "error",
            "-i", str(in_path),
            "-ac", "1", "-ar", "16000",
            str(wav_path),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, err = await proc.communicate()
        if proc.returncode != 0:
            raise STTError(f"ffmpeg failed: {err.decode(errors='ignore')}")

        # whisper-cli
        args = [
            WHISPER_CLI,
            "-m", str(MODEL_PATH),
            "-f", str(wav_path),
            "-nt",          # no timestamps
            "-otxt",        # write .txt
            "-of", str(wav_path.with_suffix("")),
        ]
        if language and language != "auto":
            args += ["-l", language]
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, err = await proc.communicate()
        if proc.returncode != 0:
            raise STTError(f"whisper-cli failed: {err.decode(errors='ignore')}")

        txt_path = wav_path.with_suffix(".txt")
        if txt_path.exists():
            return txt_path.read_text().strip()
        return out.decode(errors="ignore").strip()

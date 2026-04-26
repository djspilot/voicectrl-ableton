# VoiceCtrl — local voice assistant for Ableton Live

A 100% local voice → action plugin for [Ableton Live](https://www.ableton.com/).
Speak musical instructions; **whisper.cpp** does speech-to-text, a local **Ollama**
LLM (`qwen2.5:7b-instruct`) translates the request into tool calls, and they are
executed inside Live through the [AbletonMCP Remote Script](https://github.com/ahujasid/ableton-mcp).

> No cloud. No API keys. Audio never leaves your machine.

```
mic → plugin (capture buffer)
        ↓ ────────────────────────────
        │  whisper-cli (ggml-base.en) │
        │  Ollama  qwen2.5:7b-instruct │
        │  TCP :9877  →  AbletonMCP    │
        └──────────────────────────────
                       ↓
                  Ableton Live
```

## What's in the repo

| Path | What |
|---|---|
| [`src/`](src/) | Modular Node.js source (server, pipeline, services) |
| [`device/`](device/) | Max-for-Live `.amxd` wrapper |
| [`web/`](web/) | The HTML mic-button UI shown inside the M4L `[jweb]` |
| [`build_amxd.py`](build_amxd.py) | Generator that packs the patcher into a real `.amxd` |
| [`models/`](models/) | Whisper ggml model (download separately) |

## Requirements

* macOS 11+ on Apple Silicon (Intel works but is slower)
* [Ableton Live 11+](https://www.ableton.com/) (Suite for the M4L device)
* [Ollama](https://ollama.com/) running locally
* [whisper.cpp](https://github.com/ggerganov/whisper.cpp) (`brew install whisper-cpp`)
* `ffmpeg` (`brew install ffmpeg`)
* The [AbletonMCP](https://github.com/ahujasid/ableton-mcp) Remote Script
  installed and enabled in Live → *Preferences → Link/Tempo/MIDI →
  Control Surface: AbletonMCP*

```sh
brew install ollama whisper-cpp ffmpeg cmake
ollama pull qwen2.5:7b-instruct
```

## Build & install the Max-for-Live device

```sh
python3 build_amxd.py
```

Installs `VoiceCtrl.amxd` into `~/Music/Ableton/User Library/Presets/Audio
Effects/Max Audio Effect/`. The device boots a small Node-for-Max helper on
`127.0.0.1:8765` and shows a `[jweb]` UI inside the device.

## Start the helper manually

```sh
./run.sh
# or
npm start
```

## Voice commands (examples)

* "Play" / "Stop"
* "Set the tempo to 124"
* "Mute track 2 and solo track 4"
* "Set the volume of track 1 to -6 dB"
* "Loop bars 1 to 4"
* "Create a new MIDI track"
* "Capture MIDI"

The full tool set lives in [`src/pipeline.js`](src/pipeline.js). Adding a new
command is one entry in `COMMAND_MAP`.

## Architecture

The Max-for-Live device boots a Node-for-Max helper (`src/index.js`) on
`127.0.0.1:8765` that:

1. Receives audio from the `[jweb]` UI
2. Converts to 16 kHz mono WAV with `ffmpeg`
3. Spawns `whisper-cli` → transcript
4. POSTs to Ollama `/api/chat` with tool definitions
5. Iterates tool calls, translates each to AbletonMCP JSON, opens a TCP
   connection to `127.0.0.1:9877` and writes one JSON command per call

## Debugging

```sh
# Health check
curl http://127.0.0.1:8765/status

# Full diagnostics
curl http://127.0.0.1:8765/diagnostics

# Recent logs
curl "http://127.0.0.1:8765/logs?limit=50"

# Dry-run LLM without audio
curl -X POST http://127.0.0.1:8765/selftest -H "Content-Type: application/json" -d '{"text":"set the tempo to 120"}'
```

Logs are written to `~/Library/Logs/VoiceCtrl/` (`events.jsonl` + `helper.log`).

## Credits

* [whisper.cpp](https://github.com/ggerganov/whisper.cpp) — STT
* [Ollama](https://ollama.com/) — local LLM runtime
* [AbletonMCP](https://github.com/ahujasid/ableton-mcp) by *ahujasid* —
  the Remote Script this plugin talks to
* Inspired by [Melosurf](https://www.melosurf.com/) — same idea, built
  fully open-source and offline.

## License

MIT — see [LICENSE](LICENSE).

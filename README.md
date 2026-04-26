# VoiceCtrl — local voice assistant for Ableton Live

A 100 % local voice → action plugin for [Ableton Live](https://www.ableton.com/).
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
| [`plugin/`](plugin/) | **Real VST3 / AU / Standalone** built with JUCE 8 (recommended) |
| [`device/`](device/) | A Max-for-Live `.amxd` wrapper for the same pipeline |
| [`helper/`](helper/) | Pure-Python FastAPI service (used by the M4L device & web UI) |
| [`VoiceCtrl.js`](VoiceCtrl.js) | Same helper rewritten in Node-for-Max (no Python needed) |
| [`web/`](web/) | The HTML mic-button UI shown inside the M4L `[jweb]` |
| [`build_amxd.py`](build_amxd.py) | Generator that packs the patcher into a real `.amxd` |

You can use **either** the JUCE plugin or the M4L device — both drive the same
AbletonMCP commands, you don't need both.

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

## Build & install the JUCE plugin

```sh
git clone https://github.com/<you>/voicectrl-ableton.git
cd voicectrl-ableton

# Whisper model (~148 MB)
mkdir -p models
curl -L -o models/ggml-base.en.bin \
    https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin

# JUCE checkout (one level up by default — adjust path in plugin/CMakeLists.txt)
git clone --depth 1 https://github.com/juce-framework/JUCE.git ../JUCE

cmake -S plugin -B plugin/build -DCMAKE_BUILD_TYPE=Release
cmake --build plugin/build --config Release -j8
```

Output is auto-copied to:

* `~/Library/Audio/Plug-Ins/Components/VoiceCtrl.component`  (AU)
* `~/Library/Audio/Plug-Ins/VST3/VoiceCtrl.vst3`             (VST3)

In Ableton: *Preferences → Plug-Ins* → enable AU/VST3 → **Rescan** →
drop **VoiceCtrl** on an audio track → set *Audio From* to your mic, *Monitor*
to *In* → click **● Listen** → speak.

## Try the M4L device instead

```sh
python3 build_amxd.py
```

Installs `VoiceCtrl.amxd` into `~/Music/Ableton/User Library/Presets/Audio
Effects/Max Audio Effect/`. The device boots a small Node-for-Max helper on
`127.0.0.1:8765` and shows a `[jweb]` UI inside the device.

## Voice commands (examples)

* "Play" / "Stop"
* "Set the tempo to 124"
* "Mute track 2 and solo track 4"
* "Set the volume of track 1 to -6 dB"
* "Loop bars 1 to 4"
* "Create a new MIDI track"
* "Capture MIDI"

The full tool set lives in
[`plugin/Source/Pipeline.cpp`](plugin/Source/Pipeline.cpp) (JUCE) and
[`helper/tools.py`](helper/tools.py) / [`VoiceCtrl.js`](VoiceCtrl.js)
(M4L variant). Adding a new command is one entry in each.

## Architecture

The plugin runs the audio capture in Live's audio thread, then hands the
buffer off to a background `Pipeline` thread that:

1. Writes a 16 kHz mono WAV (`juce::WavAudioFormat`)
2. Spawns `whisper-cli` (`juce::ChildProcess`) → transcript
3. POSTs to Ollama `/api/chat` with the tool definitions
4. Iterates `tool_calls`, translates each call to AbletonMCP JSON, opens a
   TCP connection to `127.0.0.1:9877` and writes one JSON command per call

That last step is what AbletonMCP's Remote Script accepts — a single JSON
object per connection.

## Credits

* [JUCE](https://juce.com/) — audio plugin framework
* [whisper.cpp](https://github.com/ggerganov/whisper.cpp) — STT
* [Ollama](https://ollama.com/) — local LLM runtime
* [AbletonMCP](https://github.com/ahujasid/ableton-mcp) by *ahujasid* —
  the Remote Script this plugin talks to
* Inspired by [Melosurf](https://www.melosurf.com/) — same idea, built
  fully open-source and offline.

## License

MIT — see [LICENSE](LICENSE).

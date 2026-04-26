#!/usr/bin/env bash
# Start the VoiceCtrl Node helper on :8765.
set -euo pipefail
cd "$(dirname "$0")"

if ! curl -sSf http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  echo "starting ollama serve in background"
  (ollama serve >/tmp/ollama.log 2>&1 &)
  sleep 2
fi

echo "starting VoiceCtrl helper on http://127.0.0.1:8765"
exec node src/index.js

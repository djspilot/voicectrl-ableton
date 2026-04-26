#!/usr/bin/env bash
# Start the VoiceCtrl helper (FastAPI on :8765).
set -euo pipefail
cd "$(dirname "$0")"

# Make sure ollama is up
if ! curl -sSf http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  echo "→ starting ollama serve in background"
  (ollama serve >/tmp/ollama.log 2>&1 &)
  sleep 2
fi

echo "→ starting VoiceCtrl helper on http://127.0.0.1:8765"
exec uv run --with-requirements <(echo -e "fastapi\nuvicorn[standard]\nhttpx\npython-multipart") \
  python -m uvicorn helper.main:app --host 127.0.0.1 --port 8765

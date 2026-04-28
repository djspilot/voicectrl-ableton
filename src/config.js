"use strict";

const path = require("node:path");
const os   = require("node:os");
const fs   = require("node:fs");

// ── paths ──────────────────────────────────────────────────────────────────
function findBinary(name, fallback) {
  try {
    const { execSync } = require("node:child_process");
    return execSync(`which ${name}`, { timeout: 5000 }).toString().trim() || fallback;
  } catch { return fallback; }
}

const ROOT       = process.env.VOICECTRL_ROOT || path.resolve(__dirname, "..");
const WEB_DIR    = path.join(ROOT, "web");
const LOG_DIR    = process.env.VOICECTRL_LOG_DIR
                     || path.join(os.homedir(), "Library", "Logs", "VoiceCtrl");
const MODEL_PATH = process.env.VOICECTRL_WHISPER_MODEL
                     || path.join(ROOT, "models", "ggml-small.en.bin");

// ── external services ───────────────────────────────────────────────────────
const OLLAMA_URL   = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const MODEL        = process.env.VOICECTRL_MODEL || "qwen2.5:7b-instruct";
const ABLETON_HOST = "127.0.0.1";
const ABLETON_PORT = 9877;

// ── timeouts (ms) ──────────────────────────────────────────────────────────
const OLLAMA_TIMEOUT  = 30_000;
const ABLETON_TIMEOUT = 10_000;
const WHISPER_TIMEOUT = 60_000;

// ── binaries (auto-detect PATH, fall back to Homebrew macOS) ───────────────
const FFMPEG      = findBinary("ffmpeg",      "/opt/homebrew/bin/ffmpeg");
const WHISPER_CLI = findBinary("whisper-cli", "/opt/homebrew/bin/whisper-cli");

// ── server ─────────────────────────────────────────────────────────────────
const PORT = 8765;

// ── identity ─────────────────────────────────────────────────────────────
const SERVICE_ID = "voicectrl-node";
const START_TIME = Date.now();

// ── log files ────────────────────────────────────────────────────────────────
const TEXT_LOG  = path.join(LOG_DIR, "helper.log");
const EVENT_LOG = path.join(LOG_DIR, "events.jsonl");

module.exports = {
  ROOT, WEB_DIR, LOG_DIR, MODEL_PATH,
  OLLAMA_URL, MODEL, ABLETON_HOST, ABLETON_PORT,
  OLLAMA_TIMEOUT, ABLETON_TIMEOUT, WHISPER_TIMEOUT,
  FFMPEG, WHISPER_CLI,
  PORT, SERVICE_ID, START_TIME,
  TEXT_LOG, EVENT_LOG,
};

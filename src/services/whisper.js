"use strict";

const fs    = require("node:fs");
const path  = require("node:path");
const os    = require("node:os");
const { spawn } = require("node:child_process");
const config = require("../config");
const logger = require("../logger");

function spawnP(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, opts);
    let out = "", er = "";
    p.stdout?.on("data", d => out += d.toString());
    p.stderr?.on("data", d => er  += d.toString());
    p.on("error", e => reject(new Error(`${cmd} not found: ${e.message}`)));
    p.on("close", code => code === 0 ? resolve({ out, er }) : reject(new Error(`${cmd} exited ${code}: ${er.trim()}`)));
  });
}

async function transcribe(audioBytes, rid) {
  if (!fs.existsSync(config.WHISPER_CLI)) {
    throw new Error(`whisper-cli not found at ${config.WHISPER_CLI} — install with: brew install whisper-cpp`);
  }
  if (!fs.existsSync(config.MODEL_PATH)) {
    throw new Error(`whisper model missing: ${config.MODEL_PATH} — download ggml-small.en.bin (488MB): curl -L -o "${config.MODEL_PATH}" https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin`);
  }

  const tmp     = fs.mkdtempSync(path.join(os.tmpdir(), "voicectrl-"));
  const inPath  = path.join(tmp, "in.bin");
  const wavPath = path.join(tmp, "in.wav");
  fs.writeFileSync(inPath, audioBytes);

  try {
    const FFMPEG_TIMEOUT = Math.min(config.WHISPER_TIMEOUT, 30_000);
    const ffmpegDone = spawnP(config.FFMPEG, [
      "-y", "-loglevel", "error", "-i", inPath,
      "-ac", "1", "-ar", "16000", wavPath,
    ]);
    const ffmpegTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`ffmpeg timeout (${FFMPEG_TIMEOUT}ms)`)), FFMPEG_TIMEOUT)
    );
    await Promise.race([ffmpegDone, ffmpegTimeout]);

    const whisperDone = spawnP(config.WHISPER_CLI, [
      "-m", config.MODEL_PATH, "-f", wavPath, "-nt", "-otxt", "-of", path.join(tmp, "in"),
    ]);
    const whisperTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`whisper timeout (${config.WHISPER_TIMEOUT}ms)`)), config.WHISPER_TIMEOUT)
    );
    await Promise.race([whisperDone, whisperTimeout]);

    const txtPath = path.join(tmp, "in.txt");
    const transcript = fs.existsSync(txtPath)
      ? fs.readFileSync(txtPath, "utf8").trim()
      : "";
    logger.debug(`transcribe done: "${transcript}"`, rid);
    return transcript;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = { transcribe };

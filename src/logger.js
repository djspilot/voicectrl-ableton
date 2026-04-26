"use strict";

const fs    = require("node:fs");
const path  = require("node:path");
const os    = require("node:os");
const crypto = require("node:crypto");
const config = require("./config");

// ── ensure log dir ─────────────────────────────────────────────────────────
fs.mkdirSync(config.LOG_DIR, { recursive: true });

// ── in-memory ring buffer ─────────────────────────────────────────────────
const MAX_LOGS = 500;
const logs     = [];
let logFileError = null; // set to error string if file write fails

function push(entry) {
  logs.push(entry);
  if (logs.length > MAX_LOGS) logs.shift();
  // write to files — NO silent catch, surface errors visibly
  const textLine  = `[${entry.ts}] ${entry.level.toUpperCase()} [${entry.rid || "—"}] ${entry.msg}\n`;
  const jsonLine  = JSON.stringify(entry) + "\n";
  try {
    fs.appendFileSync(config.TEXT_LOG, textLine);
    fs.appendFileSync(config.EVENT_LOG, jsonLine);
    logFileError = null;
  } catch (e) {
    logFileError = e.message;
    // last resort: Max.post still prints even if file write fails
    if (Max) Max.post("[VoiceCtrl] LOG WRITE FAILED: " + e.message);
  }
}

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
let minLevel = LEVELS[process.env.VOICECTRL_LOG_LEVEL] ?? LEVELS.info;

function shouldLog(level) {
  return LEVELS[level] >= minLevel;
}

function log(level, msg, rid) {
  if (!shouldLog(level)) return;
  const entry = {
    ts:   new Date().toISOString(),
    level,
    msg:  Array.isArray(msg) ? msg.join(" ") : String(msg),
    rid:  rid || null,
  };
  push(entry);
  if (Max) Max.post(`[VoiceCtrl] ${entry.msg}`);
}

const logger = {
  debug: (msg, rid) => log("debug", msg, rid),
  info:  (msg, rid) => log("info",  msg, rid),
  warn:  (msg, rid) => log("warn",  msg, rid),
  error: (msg, rid) => log("error", msg, rid),
  /** generate a request ID for correlation */
  rid: () => crypto.randomUUID(),
  /** get recent logs for debug endpoints */
  recent: (n = 50) => logs.slice(-(n > logs.length ? logs.length : n)),
  /** check if file logging is healthy */
  healthy: () => logFileError === null,
  fileError: () => logFileError,
};

// ── Max stub (used outside Max environment) ────────────────────────────────
let Max;
try { Max = require("max-api"); }
catch { Max = { post: (...a) => console.log(...a), POST_LEVELS: { ERROR: "error" } }; }

module.exports = logger;

"use strict";

const http  = require("node:http");
const fs    = require("node:fs");
const path  = require("node:path");
const config = require("./config");
const logger     = require("./logger");
const { abletonHealth } = require("./services/ableton");
const { ollamaHealth }  = require("./services/ollama");
const { processAudio, processCommand, toolStatus } = require("./pipeline");

// ── MIME types ─────────────────────────────────────────────────────────────
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript",
  ".css":  "text/css",
  ".png":  "image/png",
  ".svg":  "image/svg+xml",
};

// ── helpers ────────────────────────────────────────────────────────────────
function send(res, code, headers, body) {
  res.writeHead(code, {
    "access-control-allow-origin": "*",
    "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
    "pragma": "no-cache",
    "expires": "0",
    ...headers,
  });
  res.end(body);
}

function sendJSON(res, code, obj) {
  send(res, code, { "content-type": "application/json" }, JSON.stringify(obj));
}

function publicState() {
  return {
    service:   config.SERVICE_ID,
    pid:       process.pid,
    uptime_s:  Math.floor((Date.now() - config.START_TIME) / 1000),
    root:      config.ROOT,
    log_dir:   config.LOG_DIR,
    model:     config.MODEL,
    ollama_url: config.OLLAMA_URL,
    ableton_host:  config.ABLETON_HOST,
    ableton_port:  config.ABLETON_PORT,
    api_port:  config.PORT,
    paths: {
      ffmpeg:        config.FFMPEG,
      whisper_cli:   config.WHISPER_CLI,
      whisper_model: config.MODEL_PATH,
    },
    exists: {
      ffmpeg:        fs.existsSync(config.FFMPEG),
      whisper_cli:   fs.existsSync(config.WHISPER_CLI),
      whisper_model: fs.existsSync(config.MODEL_PATH),
      web_dir:       fs.existsSync(config.WEB_DIR),
    },
    log_healthy: logger.healthy(),
    log_file_error: logger.fileError(),
  };
}

async function diagnostics(rid) {
  const [ableton, ollama] = await Promise.all([
    abletonHealth(),
    ollamaHealth().catch(e => ({ ok: false, error: e.message })),
  ]);
  const checks = [
    { id: "api",         label: "VoiceCtrl API",    ok: true,                        detail: `127.0.0.1:${config.PORT}` },
    { id: "ffmpeg",      label: "ffmpeg",           ok: fs.existsSync(config.FFMPEG),    detail: config.FFMPEG },
    { id: "whisper_cli", label: "whisper-cli",      ok: fs.existsSync(config.WHISPER_CLI), detail: config.WHISPER_CLI },
    { id: "whisper_model",label:"Whisper model",    ok: fs.existsSync(config.MODEL_PATH), detail: config.MODEL_PATH },
    { id: "ollama",      label: "Ollama",            ok: ollama.ok,  detail: ollama.error || `${config.MODEL} @ ${config.OLLAMA_URL} (${ollama.ms}ms)` },
    { id: "ableton",     label: "AbletonMCP",       ok: ableton.ok, detail: ableton.error || "connected" },
    { id: "log_file",    label: "Log file write",    ok: logger.healthy(), detail: logger.fileError() || "ok" },
  ];
  const fixes = [];
  if (!fs.existsSync(config.FFMPEG))      fixes.push("Install ffmpeg:        brew install ffmpeg");
  if (!fs.existsSync(config.WHISPER_CLI)) fixes.push("Install whisper.cpp:   brew install whisper-cpp");
  if (!fs.existsSync(config.MODEL_PATH))  fixes.push(`Download ggml-small.en.bin (488MB) to ${config.MODEL_PATH} — see README for instructions`);
  if (!ollama.ok)                         fixes.push(`Start Ollama: ollama serve && ollama pull ${config.MODEL}`);
  if (!ableton.ok)                        fixes.push("In Ableton: Preferences > Link/Tempo/MIDI > Control Surface = AbletonMCP, restart Live");

  return {
    ...publicState(),
    rid: rid || null,
    checks,
    fixes,
    tools: toolStatus(),
    recent_logs: logger.recent(50),
  };
}

async function selfTest(text = "set the tempo to 120", rid) {
  const started = Date.now();
  const diag    = await diagnostics(rid);
  const result  = { ts: new Date().toISOString(), input: text, checks: diag.checks, fixes: diag.fixes, dry_run: null, duration_ms: 0, rid };
  try {
    const { plan } = require("./services/ollama");
    const { extractToolCalls } = require("./services/ollama");
    const resp = await plan(text, rid);
    const calls = extractToolCalls(resp);
    result.dry_run = { ok: calls.length > 0, calls, assistant: resp.message?.content || "" };
  } catch (e) {
    result.dry_run = { ok: false, error: e.message };
  }
  result.duration_ms = Date.now() - started;
  return result;
}

async function readBody(req, max = 50 * 1024 * 1024, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("body read timeout")), timeoutMs);
    const chunks = []; let total = 0;
    req.on("data", c => {
      chunks.push(c); total += c.length;
      if (total > max) { clearTimeout(timer); reject(new Error("body too large")); }
    });
    req.on("end", () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
    req.on("error", e => { clearTimeout(timer); reject(e); });
  });
}

function stripMultipart(buf, ctype = "") {
  const m = ctype.match(/boundary=(.+)$/i);
  if (!m) return buf;
  const boundary = "--" + m[1];
  const text     = buf.toString("binary");
  const start    = text.indexOf(boundary);
  if (start < 0) return buf;
  const hdrEnd = text.indexOf("\r\n\r\n", start);
  if (hdrEnd < 0) return buf;
  const dataStart = hdrEnd + 4;
  const dataEnd   = text.indexOf("\r\n" + boundary, dataStart);
  if (dataEnd < 0) return buf;
  return Buffer.from(text.slice(dataStart, dataEnd), "binary");
}

// ── server ──────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const rid = logger.rid();
  try {
    if (req.method === "OPTIONS") {
      send(res, 204, { "access-control-allow-methods": "GET,POST", "access-control-allow-headers": "*" }, "");
      return;
    }

    const url = new URL(req.url, "http://x");

    // static files
    if ((req.method === "GET" || req.method === "HEAD") && /^\/(index\.html)?$/.test(url.pathname)) {
      send(res, 200, { "content-type": "text/html; charset=utf-8" }, fs.readFileSync(path.join(config.WEB_DIR, "index.html")));
      return;
    }
    if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/debug.html") {
      send(res, 200, { "content-type": "text/html; charset=utf-8" }, fs.readFileSync(path.join(config.WEB_DIR, "debug.html")));
      return;
    }
    if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/icon.svg") {
      send(res, 200, { "content-type": "image/svg+xml" }, fs.readFileSync(path.join(config.WEB_DIR, "icon.svg")));
      return;
    }
    if ((req.method === "GET" || req.method === "HEAD") && url.pathname.startsWith("/static/")) {
      const f = path.join(config.WEB_DIR, url.pathname.replace(/^\/static\//, ""));
      if (fs.existsSync(f) && f.startsWith(config.WEB_DIR)) {
        send(res, 200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" }, fs.readFileSync(f));
      } else send(res, 404, {}, "");
      return;
    }

    // status
    if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/status") {
      const [ableton, ollama] = await Promise.all([abletonHealth(), ollamaHealth()]);
      sendJSON(res, 200, { service: config.SERVICE_ID, pid: process.pid, uptime_s: Math.floor((Date.now() - config.START_TIME) / 1000),
        ableton: ableton.ok, ableton_error: ableton.error || "",
        ollama_ok: ollama.ok, ollama_error: ollama.error || "", model: config.MODEL, ollama: config.OLLAMA_URL });
      return;
    }

    // diagnostics
    if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/diagnostics") {
      sendJSON(res, 200, await diagnostics(rid));
      return;
    }

    // logs
    if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/logs") {
      const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get("limit") || 200)));
      const lines = fs.existsSync(config.TEXT_LOG)
        ? fs.readFileSync(config.TEXT_LOG, "utf8").trim().split("\n").slice(-limit)
        : [];
      sendJSON(res, 200, { log: config.TEXT_LOG, lines, rid });
      return;
    }

    // debug state
    if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/debug") {
      sendJSON(res, 200, { ...publicState(), rid, recent_logs: logger.recent(50) });
      return;
    }

    // tool status
    if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/tools") {
      sendJSON(res, 200, { tools: toolStatus(), rid });
      return;
    }

    // POST /selftest
    if (req.method === "POST" && url.pathname === "/selftest") {
      const body = await readBody(req, 1024 * 1024);
      const parsed = body.length ? JSON.parse(body.toString("utf8") || "{}") : {};
      sendJSON(res, 200, await selfTest(parsed.text || "set the tempo to 120", rid));
      return;
    }

    // POST /command
    if (req.method === "POST" && url.pathname === "/command") {
      const body = await readBody(req);
      const { text } = JSON.parse(body.toString("utf8") || "{}");
      if (!text) { sendJSON(res, 400, { error: "missing text", rid }); return; }
      const result = await processCommand(text, rid);
      sendJSON(res, 200, result);
      return;
    }

    // POST /listen
    if (req.method === "POST" && url.pathname === "/listen") {
      const body    = await readBody(req);
      const audio   = stripMultipart(body, req.headers["content-type"]);
      if (!audio?.length) { sendJSON(res, 400, { error: "empty audio", rid }); return; }
      const result = await processAudio(audio, rid);
      sendJSON(res, 200, result);
      return;
    }

    send(res, 404, {}, "not found");
  } catch (e) {
    logger.error(`[${rid}] http error: ${e.stack || e.message}`, rid);
    sendJSON(res, 500, { error: e.message, rid });
  }
});

module.exports = { server };

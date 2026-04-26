// VoiceCtrl — Node-for-Max helper.
//
// Runs inside Ableton's bundled Node (v20+). Started automatically by the
// node.script object inside the .amxd device. Implements the full pipeline:
//
//     mic (jweb)  ──POST /listen──▶  this script
//                                       │
//                                       ├── ffmpeg → 16k mono wav
//                                       ├── whisper-cli → transcript
//                                       ├── Ollama /api/chat (tool calling)
//                                       └── TCP :9877 → AbletonMCP Remote Script
//
// All local. No Python. No external services.

const http      = require("node:http");
const net       = require("node:net");
const fs        = require("node:fs");
const path      = require("node:path");
const os        = require("node:os");
const { spawn } = require("node:child_process");
let Max;
try {
  Max = require("max-api");
} catch {
  Max = {
    POST_LEVELS: { ERROR: "error" },
    post: (...a) => console.log(...a),
    outlet: (...a) => console.log("[outlet]", ...a),
    addHandler: () => {},
  };
}

// ── config ────────────────────────────────────────────────────────────────
const ROOT          = process.env.VOICECTRL_ROOT || path.resolve(__dirname);
const WEB_DIR       = path.join(ROOT, "web");
const MODEL_PATH    = process.env.VOICECTRL_WHISPER_MODEL || path.join(ROOT, "models", "ggml-base.en.bin");
const PORT          = 8765;
const ABLETON_HOST  = "127.0.0.1";
const ABLETON_PORT  = 9877;
const OLLAMA_URL    = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const MODEL         = process.env.VOICECTRL_MODEL || "qwen2.5:7b-instruct";
const FFMPEG        = "/opt/homebrew/bin/ffmpeg";
const WHISPER_CLI   = "/opt/homebrew/bin/whisper-cli";
const START_TIME    = Date.now();
const SERVICE_ID    = "voicectrl-node";
const DEBUG_MAX     = 250;
const LOG_DIR       = process.env.VOICECTRL_LOG_DIR || path.join(os.homedir(), "Library", "Logs", "VoiceCtrl");
const EVENT_LOG     = path.join(LOG_DIR, "events.jsonl");
const TEXT_LOG      = path.join(LOG_DIR, "helper.log");
const DEBUG_LOGS    = [];
let LAST_TRANSCRIPT = "";
let LAST_PLAN       = null;
let LAST_ERROR      = "";
let LAST_RESULT     = null;
let LAST_REQUEST    = null;

fs.mkdirSync(LOG_DIR, { recursive: true });

function pushDebug(level, parts) {
  const msg = parts.map(x => String(x)).join(" ");
  const entry = { ts: new Date().toISOString(), level, msg };
  DEBUG_LOGS.push(entry);
  if (DEBUG_LOGS.length > DEBUG_MAX) DEBUG_LOGS.splice(0, DEBUG_LOGS.length - DEBUG_MAX);
  try {
    fs.appendFileSync(TEXT_LOG, `[${entry.ts}] ${level.toUpperCase()} ${msg}\n`);
    fs.appendFileSync(EVENT_LOG, JSON.stringify(entry) + "\n");
  } catch {}
}

const log = (...a) => { pushDebug("info", a); Max.post("[VoiceCtrl] " + a.join(" ")); };
const err = (...a) => { pushDebug("error", a); Max.post("[VoiceCtrl] " + a.join(" "), Max.POST_LEVELS.ERROR); };
const warn = (...a) => { pushDebug("warn", a); Max.post("[VoiceCtrl] " + a.join(" ")); };

// ── tool definitions for the LLM ──────────────────────────────────────────
const TOOLS = [
  tool("start_playback",        "Start playback in Ableton Live."),
  tool("stop_playback",         "Stop playback in Ableton Live."),
  tool("set_tempo",             "Set the song tempo (BPM).",
       { tempo: num("BPM, 20-999") }, ["tempo"]),
  tool("set_metronome",         "Enable or disable the metronome.",
       { enabled: bool() }, ["enabled"]),
  tool("start_recording",       "Start arrangement recording."),
  tool("stop_recording",        "Stop recording."),
  tool("toggle_session_record", "Toggle the session record button."),
  tool("capture_midi",          "Capture recently played MIDI into a clip."),
  tool("create_midi_track",     "Create a new MIDI track at the given index (-1 = end).",
       { index: int("track index, -1 for end") }),
  tool("create_audio_track",    "Create a new audio track at the given index (-1 = end).",
       { index: int("track index, -1 for end") }),
  tool("set_track_volume",      "Set track volume in dB (e.g. -6, 0, +3).",
       { track_index: int(), volume_db: num("dB") }, ["track_index","volume_db"]),
  tool("set_track_pan",         "Set track pan (-1.0 left, 0 center, +1.0 right).",
       { track_index: int(), pan: num("-1..+1") }, ["track_index","pan"]),
  tool("set_track_mute",        "Mute or unmute a track.",
       { track_index: int(), muted: bool() }, ["track_index","muted"]),
  tool("set_track_solo",        "Solo or unsolo a track.",
       { track_index: int(), soloed: bool() }, ["track_index","soloed"]),
  tool("set_track_arm",         "Arm or disarm a track for recording.",
       { track_index: int(), armed: bool() }, ["track_index","armed"]),
  tool("select_track",          "Select the given track (by index).",
       { track_index: int() }, ["track_index"]),
  tool("fire_clip",             "Fire (launch) a clip in the session view.",
       { track_index: int(), clip_index: int() }, ["track_index","clip_index"]),
  tool("stop_clip",             "Stop a clip in the session view.",
       { track_index: int(), clip_index: int() }, ["track_index","clip_index"]),
  tool("fire_scene",            "Fire (launch) an entire scene.",
       { scene_index: int() }, ["scene_index"]),
  tool("set_arrangement_loop",  "Set the arrangement loop region in beats.",
       { start: num(), end: num(), enabled: bool() }, ["start","end"]),
  tool("jump_to_time",          "Jump the playhead to the given time (in beats).",
       { time: num() }, ["time"]),
  tool("get_session_info",      "Read the Live set: tracks, tempo, etc."),
];

function tool(name, desc, props = {}, required = []) {
  return {
    type: "function",
    function: {
      name, description: desc,
      parameters: { type: "object", properties: props, required }
    }
  };
}
function num (d="") { return { type: "number",  description: d }; }
function int (d="") { return { type: "integer", description: d }; }
function bool(d="") { return { type: "boolean", description: d }; }

// ── translate LLM call → AbletonMCP command ───────────────────────────────
function dbToLive(db) {
  if (db <= -70) return 0;
  // Live's API reports unity gain near 0.85. This keeps spoken dB values
  // musical instead of sending 0 dB as full-scale 1.0.
  return Math.min(1, Math.max(0, 0.85 * Math.pow(10, db / 20)));
}

function finiteNumber(v, name, min = -Infinity, max = Infinity) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`invalid ${name}: ${JSON.stringify(v)}`);
  if (n < min || n > max) throw new Error(`${name} out of range: ${n} (expected ${min}..${max})`);
  return n;
}

function intValue(v, name, min = -1, max = 4096) {
  const n = finiteNumber(v, name, min, max);
  if (!Number.isInteger(n)) throw new Error(`${name} must be an integer: ${n}`);
  return n;
}

function boolValue(v, name) {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "on", "yes", "1"].includes(s)) return true;
    if (["false", "off", "no", "0"].includes(s)) return false;
  }
  if (v === 1) return true;
  if (v === 0) return false;
  throw new Error(`invalid ${name}: ${JSON.stringify(v)}`);
}

function optionalIndex(v, name) {
  return v === undefined || v === null ? -1 : intValue(v, name, -1);
}

const COMMAND_MAP = {
  start_playback:        () => ["start_playback", {}],
  stop_playback:         () => ["stop_playback", {}],
  set_tempo:             a  => ["set_tempo", { tempo: finiteNumber(a.tempo, "tempo", 20, 999) }],
  set_metronome:         a  => ["set_metronome", { enabled: boolValue(a.enabled, "enabled") }],
  start_recording:       () => ["start_recording", {}],
  stop_recording:        () => ["stop_recording", {}],
  toggle_session_record: () => ["toggle_session_record", {}],
  capture_midi:          () => ["capture_midi", {}],
  create_midi_track:     a  => ["create_midi_track", { index: optionalIndex(a.index, "index") }],
  create_audio_track:    a  => ["create_audio_track", { index: optionalIndex(a.index, "index") }],
  set_track_volume:      a  => ["set_track_volume", { track_index: intValue(a.track_index, "track_index", 0), volume: dbToLive(finiteNumber(a.volume_db, "volume_db", -70, 6)) }],
  set_track_pan:         a  => ["set_track_pan",    { track_index: intValue(a.track_index, "track_index", 0), pan: finiteNumber(a.pan, "pan", -1, 1) }],
  set_track_mute:        a  => ["set_track_mute",   { track_index: intValue(a.track_index, "track_index", 0), mute: boolValue(a.muted, "muted") }],
  set_track_solo:        a  => ["set_track_solo",   { track_index: intValue(a.track_index, "track_index", 0), solo: boolValue(a.soloed, "soloed") }],
  set_track_arm:         a  => ["set_track_arm",    { track_index: intValue(a.track_index, "track_index", 0), arm:  boolValue(a.armed, "armed") }],
  select_track:          a  => ["select_track",     { track_index: intValue(a.track_index, "track_index", 0) }],
  fire_clip:             a  => ["fire_clip",        { track_index: intValue(a.track_index, "track_index", 0), clip_index: intValue(a.clip_index, "clip_index", 0) }],
  stop_clip:             a  => ["stop_clip",        { track_index: intValue(a.track_index, "track_index", 0), clip_index: intValue(a.clip_index, "clip_index", 0) }],
  fire_scene:            a  => ["fire_scene",       { scene_index: intValue(a.scene_index, "scene_index", 0) }],
  set_arrangement_loop:  a  => ["set_arrangement_loop",
                                { start: finiteNumber(a.start, "start", 0), end: finiteNumber(a.end, "end", 0), enabled: a.enabled === undefined ? true : boolValue(a.enabled, "enabled") }],
  jump_to_time:          a  => ["jump_to_time",     { time: finiteNumber(a.time, "time", 0) }],
  get_session_info:      () => ["get_session_info", {}],
};

// Commands present in ahujasid/ableton-mcp upstream as of the current remote
// script. Other commands are valid only when the user installs an extended
// AbletonMCP fork that implements them.
const UPSTREAM_ABLETON_COMMANDS = new Set([
  "get_session_info", "get_track_info", "create_midi_track", "set_track_name",
  "create_clip", "add_notes_to_clip", "set_clip_name", "set_tempo",
  "fire_clip", "stop_clip", "start_playback", "stop_playback",
  "load_browser_item",
]);

function toolStatus() {
  return Object.entries(COMMAND_MAP).map(([toolName, translate]) => {
    let command = toolName;
    try { command = translate({ tempo: 120, enabled: true, index: -1, track_index: 0, volume_db: -6, pan: 0, muted: true, soloed: true, armed: true, clip_index: 0, scene_index: 0, start: 0, end: 4, time: 0 })[0]; }
    catch {}
    return {
      tool: toolName,
      ableton_command: command,
      upstream_supported: UPSTREAM_ABLETON_COMMANDS.has(command),
    };
  });
}

// ── AbletonMCP TCP client ─────────────────────────────────────────────────
function abletonSend(type, params = {}) {
  return new Promise((resolve, reject) => {
    const sock    = new net.Socket();
    const payload = JSON.stringify({ type, params });
    let buf       = "";
    let done      = false;
    sock.setTimeout(10_000);
    sock.connect(ABLETON_PORT, ABLETON_HOST, () => sock.write(payload));
    sock.on("data", (d) => {
      buf += d.toString("utf8");
      try {
        const r = JSON.parse(buf);
        done = true;
        sock.destroy();
        if (r?.status && r.status !== "success") reject(new Error(`AbletonMCP ${type}: ${r.message || JSON.stringify(r)}`));
        else resolve(r);
      }
      catch { /* incomplete */ }
    });
    sock.on("timeout", () => { sock.destroy(); reject(new Error(`AbletonMCP timeout on ${ABLETON_HOST}:${ABLETON_PORT} for ${type}`)); });
    sock.on("error",   e  => !done && reject(new Error(`AbletonMCP connection failed on ${ABLETON_HOST}:${ABLETON_PORT}: ${e.message}`)));
    sock.on("close",   () => { if (!done) reject(new Error("AbletonMCP closed connection: " + (buf || "(empty response)"))); });
  });
}

async function abletonHealth() {
  try { const r = await abletonSend("health_check"); return { ok: r.status === "success", response: r }; }
  catch (e) { return { ok: false, error: e.message }; }
}

async function ollamaHealth() {
  try {
    const r = await fetch(OLLAMA_URL + "/api/tags");
    if (!r.ok) return { ok: false, error: `Ollama /api/tags ${r.status}` };
    const j = await r.json();
    const models = (j.models || []).map(m => m.name);
    return { ok: models.some(m => m === MODEL || m.startsWith(MODEL + ":")), models };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Speech-to-text (whisper.cpp) ──────────────────────────────────────────
function spawnP(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, opts);
    let out = "", er = "";
    p.stdout?.on("data", d => out += d.toString());
    p.stderr?.on("data", d => er  += d.toString());
    p.on("error", reject);
    p.on("close", code => code === 0 ? resolve({ out, er }) : reject(new Error(`${cmd} exit ${code}: ${er}`)));
  });
}

async function transcribe(audioBytes) {
  if (!fs.existsSync(MODEL_PATH))
    throw new Error("whisper model missing: " + MODEL_PATH);

  const tmp     = fs.mkdtempSync(path.join(os.tmpdir(), "voicectrl-"));
  const inPath  = path.join(tmp, "in.bin");
  const wavPath = path.join(tmp, "in.wav");
  fs.writeFileSync(inPath, audioBytes);

  try {
    await spawnP(FFMPEG, ["-y", "-loglevel", "error", "-i", inPath, "-ac", "1", "-ar", "16000", wavPath]);
    await spawnP(WHISPER_CLI, [
      "-m", MODEL_PATH,
      "-f", wavPath,
      "-nt", "-otxt",
      "-of", path.join(tmp, "in"),
    ]);
    const txtPath = path.join(tmp, "in.txt");
    return fs.existsSync(txtPath) ? fs.readFileSync(txtPath, "utf8").trim() : "";
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ── LLM ────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT =
  "You are VoiceCtrl, a real-time voice assistant for Ableton Live.\n" +
  "The user speaks musical instructions in any language. Translate each " +
  "instruction into one or more Ableton commands by calling the provided " +
  "tools.\n" +
  "Rules:\n" +
  "- Track and scene indexing starts at 0 (track 1 = index 0).\n" +
  "- Volumes are in dB. 0 dB is unity, -inf is silent.\n" +
  "- Only call a tool when the transcript contains a clear Ableton action " +
  "and any required value is explicit or strongly implied.\n" +
  "- Do not invent tempos, track numbers, clip slots, or actions from noisy " +
  "or unclear transcription.\n" +
  "- If the user refers to a track by name, first call get_session_info to " +
  "  resolve the name to an index, then call the action.\n" +
  "- Prefer one tool call for simple commands. Never ask follow-up questions.\n" +
  "- If no tool fits or the transcript is ambiguous, say 'No clear Ableton command detected.' without calling tools.";

async function plan(transcript) {
  log("ollama request:", MODEL, JSON.stringify(transcript));
  const r = await fetch(OLLAMA_URL + "/api/chat", {
    method:  "POST",
    headers: { "content-type": "application/json" },
    body:    JSON.stringify({
      model:    MODEL,
      stream:   false,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: transcript },
      ],
      tools:   TOOLS,
      options: { temperature: 0.1 },
    }),
  });
  if (!r.ok) throw new Error("ollama " + r.status + ": " + (await r.text()));
  const json = await r.json();
  LAST_PLAN = json;
  const toolCount = json.message?.tool_calls?.length || 0;
  log("ollama response:", toolCount, "tool call(s)");
  return json;
}

function extractToolCalls(resp) {
  const calls = (resp.message && resp.message.tool_calls) || [];
  return calls.map(c => {
    let args = c.function?.arguments;
    if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }
    return { name: c.function?.name, arguments: args || {} };
  }).filter(c => c.name);
}

async function execute(transcript) {
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const started = Date.now();
  LAST_REQUEST = { id: requestId, ts: new Date().toISOString(), transcript, stage: "start" };
  LAST_TRANSCRIPT = transcript;
  LAST_ERROR = "";
  log("transcript:", JSON.stringify(transcript));
  LAST_REQUEST.stage = "ollama";
  const resp  = await plan(transcript);
  const calls = extractToolCalls(resp);
  if (!calls.length) {
    const text = (resp.message?.content || "").trim();
    log("no tool calls; assistant:", text);
    LAST_RESULT = { request_id: requestId, transcript, actions: [], assistant: text, duration_ms: Date.now() - started };
    return LAST_RESULT;
  }
  const actions = [];
  for (const c of calls) {
    const t = COMMAND_MAP[c.name];
    if (!t) { actions.push({ tool: c.name, args: c.arguments, error: "unknown tool" }); continue; }
    try {
      LAST_REQUEST.stage = "translate";
      const [type, params] = t(c.arguments);
      if (!UPSTREAM_ABLETON_COMMANDS.has(type))
        warn("command may require an extended AbletonMCP remote script:", type);
      log("→ ableton", type, JSON.stringify(params));
      LAST_REQUEST.stage = "ableton";
      const r = await abletonSend(type, params);
      log("← ableton", type, JSON.stringify(r));
      actions.push({ tool: c.name, args: c.arguments, ableton: r });
    } catch (e) {
      LAST_ERROR = e.message;
      err("tool", c.name, "failed:", e.message);
      actions.push({ tool: c.name, args: c.arguments, error: e.message });
    }
  }
  LAST_REQUEST.stage = "done";
  LAST_RESULT = { request_id: requestId, transcript, actions, duration_ms: Date.now() - started };
  return LAST_RESULT;
}

// ── HTTP server ───────────────────────────────────────────────────────────
const MIME = {
  ".html":"text/html; charset=utf-8", ".js":"application/javascript",
  ".css":"text/css", ".png":"image/png", ".svg":"image/svg+xml",
};

function send(res, code, headers, body) {
  res.writeHead(code, {
    "access-control-allow-origin": "*",
    "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
    "pragma": "no-cache",
    "expires": "0",
    ...headers
  });
  res.end(body);
}
function sendJSON(res, code, obj) {
  send(res, code, { "content-type": "application/json" }, JSON.stringify(obj));
}

function publicState() {
  return {
    service: SERVICE_ID,
    pid: process.pid,
    uptime_s: Math.floor((Date.now() - START_TIME) / 1000),
    root: ROOT,
    log_dir: LOG_DIR,
    model: MODEL,
    ollama_url: OLLAMA_URL,
    ableton_host: ABLETON_HOST,
    ableton_port: ABLETON_PORT,
    api_port: PORT,
    paths: {
      ffmpeg: FFMPEG,
      whisper_cli: WHISPER_CLI,
      whisper_model: MODEL_PATH,
      event_log: EVENT_LOG,
      text_log: TEXT_LOG,
    },
    exists: {
      ffmpeg: fs.existsSync(FFMPEG),
      whisper_cli: fs.existsSync(WHISPER_CLI),
      whisper_model: fs.existsSync(MODEL_PATH),
      web_dir: fs.existsSync(WEB_DIR),
    },
    last: {
      transcript: LAST_TRANSCRIPT,
      plan: LAST_PLAN,
      result: LAST_RESULT,
      error: LAST_ERROR,
      request: LAST_REQUEST,
    },
  };
}

async function diagnostics() {
  const [ableton, ollama] = await Promise.all([abletonHealth(), ollamaHealth()]);
  const checks = [
    { id: "api", label: "VoiceCtrl API", ok: true, detail: `listening on 127.0.0.1:${PORT}` },
    { id: "ffmpeg", label: "ffmpeg", ok: fs.existsSync(FFMPEG), detail: FFMPEG },
    { id: "whisper_cli", label: "whisper-cli", ok: fs.existsSync(WHISPER_CLI), detail: WHISPER_CLI },
    { id: "whisper_model", label: "Whisper model", ok: fs.existsSync(MODEL_PATH), detail: MODEL_PATH },
    { id: "ollama", label: "Ollama", ok: ollama.ok, detail: ollama.error || `${OLLAMA_URL}, model=${MODEL}` },
    { id: "ableton", label: "AbletonMCP", ok: ableton.ok, detail: ableton.error || "connected" },
  ];
  const fixes = [];
  if (!fs.existsSync(FFMPEG)) fixes.push("Install ffmpeg: brew install ffmpeg");
  if (!fs.existsSync(WHISPER_CLI)) fixes.push("Install whisper.cpp: brew install whisper-cpp");
  if (!fs.existsSync(MODEL_PATH)) fixes.push(`Download ggml-base.en.bin to ${MODEL_PATH}`);
  if (!ollama.ok) fixes.push(`Start Ollama and pull model: ollama serve; ollama pull ${MODEL}`);
  if (!ableton.ok) fixes.push("In Live Preferences > Link/Tempo/MIDI, set Control Surface to AbletonMCP, then restart Live if needed.");
  return { ...publicState(), checks, fixes, tools: toolStatus(), recent_logs: DEBUG_LOGS.slice(-80) };
}

async function selfTest(text = "set the tempo to 120") {
  const started = Date.now();
  const report = await diagnostics();
  const result = {
    ts: new Date().toISOString(),
    input: text,
    checks: report.checks,
    fixes: report.fixes,
    dry_run: null,
    live_result: null,
    duration_ms: 0,
  };
  try {
    const resp = await plan(text);
    const calls = extractToolCalls(resp);
    result.dry_run = { ok: calls.length > 0, calls, assistant: resp.message?.content || "" };
    if (calls.length) {
      const first = calls[0];
      const translator = COMMAND_MAP[first.name];
      result.live_result = translator ? { command: translator(first.arguments) } : { error: "unknown tool: " + first.name };
    }
  } catch (e) {
    result.dry_run = { ok: false, error: e.message };
  }
  result.duration_ms = Date.now() - started;
  LAST_RESULT = result;
  return result;
}

async function readBody(req, max = 50 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const c of req) {
    chunks.push(c); total += c.length;
    if (total > max) throw new Error("body too large");
  }
  return Buffer.concat(chunks);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") { send(res, 204, { "access-control-allow-methods":"GET,POST", "access-control-allow-headers":"*" }, ""); return; }

    const url = new URL(req.url, "http://x");
    if ((req.method === "GET" || req.method === "HEAD") && (url.pathname === "/" || url.pathname === "/index.html")) {
      const html = fs.readFileSync(path.join(WEB_DIR, "index.html"));
      send(res, 200, { "content-type": "text/html; charset=utf-8" }, html); return;
    }
    if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/debug.html") {
      const html = fs.readFileSync(path.join(WEB_DIR, "debug.html"));
      send(res, 200, { "content-type": "text/html; charset=utf-8" }, html); return;
    }
    if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/icon.svg") {
      send(res, 200, { "content-type": "image/svg+xml" }, fs.readFileSync(path.join(WEB_DIR, "icon.svg"))); return;
    }
    if ((req.method === "GET" || req.method === "HEAD") && url.pathname.startsWith("/static/")) {
      const f = path.join(WEB_DIR, url.pathname.replace(/^\/static\//, ""));
      if (fs.existsSync(f) && f.startsWith(WEB_DIR)) {
        send(res, 200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" }, fs.readFileSync(f));
      } else send(res, 404, {}, "");
      return;
    }
    if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/status") {
      const ableton = await abletonHealth();
      const ollama = await ollamaHealth();
      sendJSON(res, 200, {
        service: SERVICE_ID,
        pid: process.pid,
        uptime_s: Math.floor((Date.now() - START_TIME) / 1000),
        root: ROOT,
        ableton: ableton.ok,
        ableton_error: ableton.error || "",
        ollama_ok: ollama.ok,
        ollama_error: ollama.error || "",
        model: MODEL,
        ollama: OLLAMA_URL,
      });
      return;
    }
    if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/diagnostics") {
      sendJSON(res, 200, await diagnostics());
      return;
    }
    if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/logs") {
      const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get("limit") || 200)));
      const lines = fs.existsSync(TEXT_LOG) ? fs.readFileSync(TEXT_LOG, "utf8").trim().split("\n").slice(-limit) : [];
      sendJSON(res, 200, { log: TEXT_LOG, lines });
      return;
    }
    if (req.method === "POST" && url.pathname === "/selftest") {
      const body = await readBody(req, 1024 * 1024);
      const parsed = body.length ? JSON.parse(body.toString("utf8") || "{}") : {};
      sendJSON(res, 200, await selfTest(parsed.text || "set the tempo to 120"));
      return;
    }
    if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/debug") {
      const state = publicState();
      sendJSON(res, 200, {
        ...state,
        web_dir: WEB_DIR,
        model_path: MODEL_PATH,
        whisper_model_exists: state.exists.whisper_model,
        ffmpeg_exists: state.exists.ffmpeg,
        whisper_cli_exists: state.exists.whisper_cli,
        ableton_port: ABLETON_PORT,
        api_port: PORT,
        last_transcript: LAST_TRANSCRIPT,
        last_tool_calls: LAST_PLAN?.message?.tool_calls || [],
        last_error: LAST_ERROR,
        tools: toolStatus(),
        logs: DEBUG_LOGS,
      });
      return;
    }
    if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/tools") {
      sendJSON(res, 200, { tools: toolStatus() });
      return;
    }
    if (req.method === "POST" && url.pathname === "/command") {
      const body = await readBody(req);
      const { text } = JSON.parse(body.toString("utf8") || "{}");
      if (!text) { sendJSON(res, 400, { error: "missing text" }); return; }
      sendJSON(res, 200, await execute(text)); return;
    }
    if (req.method === "POST" && url.pathname === "/listen") {
      const body = await readBody(req);
      // strip optional multipart wrapper if present (browser MediaRecorder uploads raw)
      const audio = stripMultipart(body, req.headers["content-type"]);
      if (!audio?.length) { sendJSON(res, 400, { error: "empty audio" }); return; }
      const transcript = await transcribe(audio);
      if (!transcript) { sendJSON(res, 200, { transcript:"", actions:[], assistant:"(no speech detected)" }); return; }
      sendJSON(res, 200, await execute(transcript)); return;
    }
    send(res, 404, {}, "not found");
  } catch (e) {
    LAST_ERROR = e.message;
    err("http error:", e.stack || e.message);
    sendJSON(res, 500, { error: e.message });
  }
});

function stripMultipart(buf, ctype = "") {
  const m = ctype.match(/boundary=(.+)$/i);
  if (!m) return buf;                      // raw body, return as-is
  const boundary = "--" + m[1];
  const text     = buf.toString("binary");
  const start    = text.indexOf(boundary);
  if (start < 0) return buf;
  // first part header ends at \r\n\r\n
  const hdrEnd = text.indexOf("\r\n\r\n", start);
  if (hdrEnd < 0) return buf;
  const dataStart = hdrEnd + 4;
  const dataEnd   = text.indexOf("\r\n" + boundary, dataStart);
  if (dataEnd < 0) return buf;
  return Buffer.from(text.slice(dataStart, dataEnd), "binary");
}

// ── start ────────────────────────────────────────────────────────────────
server.listen(PORT, "127.0.0.1", () => log("HTTP listening on", PORT, "root:", ROOT));
server.on("error", e => err("HTTP listen failed:", e.message, "(possible port conflict on", PORT + ")"));

// expose to Max
Max.addHandler("status", async () => {
  Max.outlet("ableton", (await abletonHealth()).ok ? 1 : 0);
});
Max.addHandler("say", async (...words) => {
  try { const r = await execute(words.join(" ")); Max.outlet("done", JSON.stringify(r)); }
  catch (e) { err("say failed:", e.message); }
});

process.on("SIGTERM", () => { try { server.close(); } catch {} ; process.exit(0); });
process.on("SIGINT",  () => { try { server.close(); } catch {} ; process.exit(0); });

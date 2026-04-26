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
const Max       = require("max-api");

// ── config ────────────────────────────────────────────────────────────────
const ROOT          = "/Users/ds/Documents/Max for Live/VoiceCtrl";
const WEB_DIR       = path.join(ROOT, "web");
const MODEL_PATH    = path.join(ROOT, "models", "ggml-base.en.bin");
const PORT          = 8765;
const ABLETON_HOST  = "127.0.0.1";
const ABLETON_PORT  = 9877;
const OLLAMA_URL    = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const MODEL         = process.env.VOICECTRL_MODEL || "qwen2.5:7b-instruct";
const FFMPEG        = "/opt/homebrew/bin/ffmpeg";
const WHISPER_CLI   = "/opt/homebrew/bin/whisper-cli";

const log = (...a) => Max.post("[VoiceCtrl] " + a.join(" "));
const err = (...a) => Max.post("[VoiceCtrl] " + a.join(" "), Max.POST_LEVELS.ERROR);

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
  // Ableton mixer curve approximation (0 dB == 0.85)
  return Math.min(1, Math.max(0, Math.pow(10, (db - 6) / 30) * Math.pow(10, 6 / 30)));
}

const COMMAND_MAP = {
  start_playback:        () => ["start_playback", {}],
  stop_playback:         () => ["stop_playback", {}],
  set_tempo:             a  => ["set_tempo", { tempo: +a.tempo }],
  set_metronome:         a  => ["set_metronome", { enabled: !!a.enabled }],
  start_recording:       () => ["start_recording", {}],
  stop_recording:        () => ["stop_recording", {}],
  toggle_session_record: () => ["toggle_session_record", {}],
  capture_midi:          () => ["capture_midi", {}],
  create_midi_track:     a  => ["create_midi_track", { index: a.index ?? -1 }],
  create_audio_track:    a  => ["create_audio_track", { index: a.index ?? -1 }],
  set_track_volume:      a  => ["set_track_volume", { track_index: +a.track_index, volume: dbToLive(+a.volume_db) }],
  set_track_pan:         a  => ["set_track_pan",    { track_index: +a.track_index, pan: +a.pan }],
  set_track_mute:        a  => ["set_track_mute",   { track_index: +a.track_index, mute: !!a.muted }],
  set_track_solo:        a  => ["set_track_solo",   { track_index: +a.track_index, solo: !!a.soloed }],
  set_track_arm:         a  => ["set_track_arm",    { track_index: +a.track_index, arm:  !!a.armed }],
  select_track:          a  => ["select_track",     { track_index: +a.track_index }],
  fire_clip:             a  => ["fire_clip",        { track_index: +a.track_index, clip_index: +a.clip_index }],
  stop_clip:             a  => ["stop_clip",        { track_index: +a.track_index, clip_index: +a.clip_index }],
  fire_scene:            a  => ["fire_scene",       { scene_index: +a.scene_index }],
  set_arrangement_loop:  a  => ["set_arrangement_loop",
                                { start: +a.start, end: +a.end, enabled: a.enabled !== false }],
  jump_to_time:          a  => ["jump_to_time",     { time: +a.time }],
  get_session_info:      () => ["get_session_info", {}],
};

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
      try { const r = JSON.parse(buf); done = true; sock.destroy(); resolve(r); }
      catch { /* incomplete */ }
    });
    sock.on("timeout", () => { sock.destroy(); reject(new Error("ableton tcp timeout")); });
    sock.on("error",   e  => !done && reject(e));
    sock.on("close",   () => { if (!done) reject(new Error("ableton closed connection: " + buf)); });
  });
}

async function abletonHealth() {
  try { const r = await abletonSend("health_check"); return r.status === "success"; }
  catch { return false; }
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
  "- If the user refers to a track by name, first call get_session_info to " +
  "  resolve the name to an index, then call the action.\n" +
  "- Be decisive: prefer one tool call. Never ask follow-up questions.\n" +
  "- If no tool fits, briefly explain in plain text without calling tools.";

async function plan(transcript) {
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
  return r.json();
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
  log("transcript:", JSON.stringify(transcript));
  const resp  = await plan(transcript);
  const calls = extractToolCalls(resp);
  if (!calls.length) {
    const text = (resp.message?.content || "").trim();
    log("no tool calls; assistant:", text);
    return { transcript, actions: [], assistant: text };
  }
  const actions = [];
  for (const c of calls) {
    const t = COMMAND_MAP[c.name];
    if (!t) { actions.push({ tool: c.name, args: c.arguments, error: "unknown tool" }); continue; }
    try {
      const [type, params] = t(c.arguments);
      log("→ ableton", type, JSON.stringify(params));
      const r = await abletonSend(type, params);
      actions.push({ tool: c.name, args: c.arguments, ableton: r });
    } catch (e) {
      err("tool", c.name, "failed:", e.message);
      actions.push({ tool: c.name, args: c.arguments, error: e.message });
    }
  }
  return { transcript, actions };
}

// ── HTTP server ───────────────────────────────────────────────────────────
const MIME = {
  ".html":"text/html; charset=utf-8", ".js":"application/javascript",
  ".css":"text/css", ".png":"image/png", ".svg":"image/svg+xml",
};

function send(res, code, headers, body) {
  res.writeHead(code, { "access-control-allow-origin": "*", ...headers });
  res.end(body);
}
function sendJSON(res, code, obj) {
  send(res, code, { "content-type": "application/json" }, JSON.stringify(obj));
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
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const html = fs.readFileSync(path.join(WEB_DIR, "index.html"));
      send(res, 200, { "content-type": "text/html; charset=utf-8" }, html); return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/static/")) {
      const f = path.join(WEB_DIR, url.pathname.replace(/^\/static\//, ""));
      if (fs.existsSync(f) && f.startsWith(WEB_DIR)) {
        send(res, 200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" }, fs.readFileSync(f));
      } else send(res, 404, {}, "");
      return;
    }
    if (req.method === "GET" && url.pathname === "/status") {
      sendJSON(res, 200, { ableton: await abletonHealth(), model: MODEL, ollama: OLLAMA_URL });
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
server.listen(PORT, "127.0.0.1", () => log("HTTP listening on", PORT));
server.on("error", e => err("HTTP listen failed:", e.message));

// expose to Max
Max.addHandler("status", async () => {
  Max.outlet("ableton", (await abletonHealth()) ? 1 : 0);
});
Max.addHandler("say", async (...words) => {
  try { const r = await execute(words.join(" ")); Max.outlet("done", JSON.stringify(r)); }
  catch (e) { err("say failed:", e.message); }
});

process.on("SIGTERM", () => { try { server.close(); } catch {} ; process.exit(0); });
process.on("SIGINT",  () => { try { server.close(); } catch {} ; process.exit(0); });

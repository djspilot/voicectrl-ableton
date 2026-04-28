"use strict";

const config = require("../config");
const logger    = require("../logger");

// ── tools (shared with pipeline, re-exported here for convenience) ────────
const TOOLS = [
  { type: "function", function: { name: "start_playback",        description: "Start playback in Ableton Live.", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "stop_playback",         description: "Stop playback in Ableton Live.", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "set_tempo",             description: "Set the song tempo (BPM).", parameters: { type: "object", properties: { tempo: { type: "number", description: "BPM, 20-999" } }, required: ["tempo"] } } },
  { type: "function", function: { name: "set_metronome",         description: "Enable or disable the metronome.", parameters: { type: "object", properties: { enabled: { type: "boolean", description: "enabled" } }, required: ["enabled"] } } },
  { type: "function", function: { name: "start_recording",       description: "Start arrangement recording.", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "stop_recording",        description: "Stop recording.", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "toggle_session_record", description: "Toggle the session record button.", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "capture_midi",          description: "Capture recently played MIDI into a clip.", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "create_midi_track",     description: "Create a new MIDI track at the given index (-1 = end).", parameters: { type: "object", properties: { index: { type: "integer", description: "track index, -1 for end" } }, required: [] } } },
  { type: "function", function: { name: "create_audio_track",    description: "Create a new audio track at the given index (-1 = end).", parameters: { type: "object", properties: { index: { type: "integer", description: "track index, -1 for end" } }, required: [] } } },
  { type: "function", function: { name: "set_track_volume",      description: "Set track volume in dB (e.g. -6, 0, +3).", parameters: { type: "object", properties: { track_index: { type: "integer", description: "track index" }, volume_db: { type: "number", description: "dB" } }, required: ["track_index", "volume_db"] } } },
  { type: "function", function: { name: "set_track_pan",         description: "Set track pan (-1.0 left, 0 center, +1.0 right).", parameters: { type: "object", properties: { track_index: { type: "integer", description: "track index" }, pan: { type: "number", description: "-1..+1" } }, required: ["track_index", "pan"] } } },
  { type: "function", function: { name: "set_track_mute",        description: "Mute or unmute a track.", parameters: { type: "object", properties: { track_index: { type: "integer", description: "track index" }, muted: { type: "boolean", description: "muted" } }, required: ["track_index", "muted"] } } },
  { type: "function", function: { name: "set_track_solo",        description: "Solo or unsolo a track.", parameters: { type: "object", properties: { track_index: { type: "integer", description: "track index" }, soloed: { type: "boolean", description: "soloed" } }, required: ["track_index", "soloed"] } } },
  { type: "function", function: { name: "set_track_arm",         description: "Arm or disarm a track for recording.", parameters: { type: "object", properties: { track_index: { type: "integer", description: "track index" }, armed: { type: "boolean", description: "armed" } }, required: ["track_index", "armed"] } } },
  { type: "function", function: { name: "select_track",          description: "Select the given track (by index).", parameters: { type: "object", properties: { track_index: { type: "integer", description: "track index" } }, required: ["track_index"] } } },
  { type: "function", function: { name: "fire_clip",             description: "Fire (launch) a clip in the session view.", parameters: { type: "object", properties: { track_index: { type: "integer", description: "track index" }, clip_index: { type: "integer", description: "clip index" } }, required: ["track_index", "clip_index"] } } },
  { type: "function", function: { name: "stop_clip",             description: "Stop a clip in the session view.", parameters: { type: "object", properties: { track_index: { type: "integer", description: "track index" }, clip_index: { type: "integer", description: "clip index" } }, required: ["track_index", "clip_index"] } } },
  { type: "function", function: { name: "fire_scene",            description: "Fire (launch) an entire scene.", parameters: { type: "object", properties: { scene_index: { type: "integer", description: "scene index" } }, required: ["scene_index"] } } },
  { type: "function", function: { name: "set_arrangement_loop",  description: "Set the arrangement loop region in beats.", parameters: { type: "object", properties: { start: { type: "number", description: "start beats" }, end: { type: "number", description: "end beats" }, enabled: { type: "boolean", description: "enabled" } }, required: ["start", "end"] } } },
  { type: "function", function: { name: "jump_to_time",          description: "Jump the playhead to the given time (in beats).", parameters: { type: "object", properties: { time: { type: "number", description: "time in beats" } }, required: ["time"] } } },
  { type: "function", function: { name: "get_session_info",      description: "Read the Live set: tracks, tempo, etc.", parameters: { type: "object", properties: {}, required: [] } } },
];

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

// ── circuit breaker ─────────────────────────────────────────────────────────
let failures = 0;
const CIRCUIT_THRESHOLD = 5;
const CIRCUIT_COOLDOWN  = 60_000; // ms
let circuitUntil = 0;

function isCircuitOpen() {
  return failures >= CIRCUIT_THRESHOLD && Date.now() < circuitUntil;
}

// ── retries with backoff ────────────────────────────────────────────────────
async function withRetry(fn, retries = 3, baseMs = 2000) {
  if (isCircuitOpen()) {
    throw new Error(`ollama circuit open — ${CIRCUIT_THRESHOLD} consecutive failures, cooling down for ${CIRCUIT_COOLDOWN}ms`);
  }
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); }
    catch (e) {
      failures++;
      if (failures >= CIRCUIT_THRESHOLD) {
        circuitUntil = Date.now() + CIRCUIT_COOLDOWN;
        logger.error(`ollama circuit breaker opened after ${failures} failures — cooling down ${CIRCUIT_COOLDOWN}ms`);
      }
      if (i === retries) throw e;
      const ms = baseMs * Math.pow(2, i);
      logger.warn(`ollama retry ${i+1}/${retries} after ${ms}ms: ${e.message}`);
      await new Promise(r => setTimeout(r, ms));
    }
  }
}

// ── health ─────────────────────────────────────────────────────────────────
async function ollamaHealth() {
  const started = Date.now();
  try {
    const r = await fetch(config.OLLAMA_URL + "/api/tags", {
      signal: AbortSignal.timeout(config.OLLAMA_TIMEOUT),
    });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}`, ms: Date.now() - started };
    const j    = await r.json();
    const models = (j.models || []).map(m => m.name);
    const found = models.some(m => m === config.MODEL || m.startsWith(config.MODEL + ":"));
    return { ok: found, models, ms: Date.now() - started };
  } catch (e) {
    return { ok: false, error: e.message, ms: Date.now() - started };
  }
}

// ── plan (main LLM call) ───────────────────────────────────────────────────
function recordSuccess() { failures = 0; circuitUntil = 0; }

async function plan(transcript, rid) {
  const url = config.OLLAMA_URL + "/api/chat";
  logger.debug("ollama request: " + config.MODEL, rid);

  const response = await withRetry(async () => {
    const r = await fetch(url, {
      method:  "POST",
      headers: { "content-type": "application/json" },
      signal:  AbortSignal.timeout(config.OLLAMA_TIMEOUT),
      body: JSON.stringify({
        model:    config.MODEL,
        stream:   false,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user",   content: transcript },
        ],
        tools: TOOLS,
        options: { temperature: 0.1 },
      }),
    });
    if (!r.ok) throw new Error(`ollama HTTP ${r.status}: ${await r.text()}`);
    return r.json();
  }, 3, 2000);

  recordSuccess();
  const toolCount = response.message?.tool_calls?.length || 0;
  logger.debug(`ollama response: ${toolCount} tool call(s)`, rid);
  return response;
}

function extractToolCalls(resp) {
  const calls = (resp.message && resp.message.tool_calls) || [];
  return calls.map(c => {
    let args = c.function?.arguments;
    if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }
    return { name: c.function?.name, arguments: args || {} };
  }).filter(c => c.name);
}

module.exports = { TOOLS, SYSTEM_PROMPT, ollamaHealth, plan, extractToolCalls };

"use strict";

const config = require("./config");
const logger    = require("./logger");
const { abletonSend } = require("./services/ableton");
const { plan, extractToolCalls } = require("./services/ollama");
const { transcribe } = require("./services/whisper");

// ── validation helpers ─────────────────────────────────────────────────────
function dbToLive(db) {
  if (db <= -70) return 0;
  return Math.min(1, Math.max(0, 0.85 * Math.pow(10, db / 20)));
}

function finiteNumber(v, name, min = -Infinity, max = Infinity) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`invalid ${name}: ${JSON.stringify(v)}`);
  if (n < min || n > max) throw new Error(`${name} out of range: ${n} (${min}..${max})`);
  return n;
}

function intValue(v, name, min = -1, max = 4096) {
  const n = finiteNumber(v, name, min, max);
  if (!Number.isInteger(n)) throw new Error(`${name} must be integer: ${n}`);
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

// ── command map ────────────────────────────────────────────────────────────
const COMMAND_MAP = {
  start_playback:        () => ["start_playback", {}],
  stop_playback:         () => ["stop_playback", {}],
  set_tempo:             a  => ["set_tempo", { tempo: finiteNumber(a.tempo, "tempo", 20, 999) }],
  set_metronome:         a  => ["set_metronome", { enabled: boolValue(a.enabled, "enabled") }],
  start_recording:       () => ["start_recording", {}],
  stop_recording:        () => ["stop_recording", {}],
  toggle_session_record: () => ["toggle_session_record", {}],
  capture_midi:          () => ["capture_midi", {}],
  create_midi_track:     a  => ["create_midi_track", { index: a.index === undefined || a.index === null ? -1 : intValue(a.index, "index", -1) }],
  create_audio_track:    a  => ["create_audio_track", { index: a.index === undefined || a.index === null ? -1 : intValue(a.index, "index", -1) }],
  set_track_volume:      a  => ["set_track_volume", { track_index: intValue(a.track_index, "track_index", 0), volume: dbToLive(finiteNumber(a.volume_db, "volume_db", -70, 6)) }],
  set_track_pan:         a  => ["set_track_pan",    { track_index: intValue(a.track_index, "track_index", 0), pan: finiteNumber(a.pan, "pan", -1, 1) }],
  set_track_mute:        a  => ["set_track_mute",   { track_index: intValue(a.track_index, "track_index", 0), mute: boolValue(a.muted, "muted") }],
  set_track_solo:        a  => ["set_track_solo",   { track_index: intValue(a.track_index, "track_index", 0), solo: boolValue(a.soloed, "soloed") }],
  set_track_arm:         a  => ["set_track_arm",    { track_index: intValue(a.track_index, "track_index", 0), arm:  boolValue(a.armed, "armed") }],
  select_track:          a  => ["select_track",     { track_index: intValue(a.track_index, "track_index", 0) }],
  fire_clip:             a  => ["fire_clip",        { track_index: intValue(a.track_index, "track_index", 0), clip_index: intValue(a.clip_index, "clip_index", 0) }],
  stop_clip:             a  => ["stop_clip",        { track_index: intValue(a.track_index, "track_index", 0), clip_index: intValue(a.clip_index, "clip_index", 0) }],
  fire_scene:            a  => ["fire_scene",       { scene_index: intValue(a.scene_index, "scene_index", 0) }],
  set_arrangement_loop:  a  => ["set_arrangement_loop", { start: finiteNumber(a.start, "start", 0), end: finiteNumber(a.end, "end", 0), enabled: a.enabled === undefined ? true : boolValue(a.enabled, "enabled") }],
  jump_to_time:          a  => ["jump_to_time",     { time: finiteNumber(a.time, "time", 0) }],
  get_session_info:      () => ["get_session_info", {}],
};

const UPSTREAM_ABLETON_COMMANDS = new Set([
  "get_session_info", "get_track_info", "create_midi_track", "set_track_name",
  "create_clip", "add_notes_to_clip", "set_clip_name", "set_tempo",
  "fire_clip", "stop_clip", "start_playback", "stop_playback",
  "load_browser_item",
]);

// ── direct dispatch patterns ────────────────────────────────────────────────
// Simple commands matched by regex — no LLM needed.
// Returns { tool, args } or null (falls through to LLM).
function tryDirectParse(text) {
  const t = text.toLowerCase().trim();
  const num = (str) => {
    const m = str.match(/[\d.]+/);
    return m ? parseFloat(m[0]) : null;
  };
  const trackNum = (str) => {
    const m = str.match(/(?:track |tr )?(\d+)/i);
    return m ? parseInt(m[1]) - 1 : 0; // 1-based → 0-based
  };

  // Transport
  if (/\b(play|start|begin|resume|go)\b/i.test(t) && !/\b(stop|pause)\b/i.test(t))
    return { tool: "start_playback", args: {} };
  if (/\b(stop|pause|halt)\b/i.test(t) && !/\b(stop clip|stop recording)\b/i.test(t))
    return { tool: "stop_playback", args: {} };
  if (/\b(stop recording|stop record)\b/i.test(t))
    return { tool: "stop_recording", args: {} };
  if (/\brecord\b/i.test(t) && !/\bstop\b/i.test(t))
    return { tool: "start_recording", args: {} };
  if (/\b(stop recording|stop record)\b/i.test(t))
    return { tool: "stop_recording", args: {} };
  if (/\b(session record|toggle session record)\b/i.test(t))
    return { tool: "toggle_session_record", args: {} };
  if (/\bcapture midi\b/i.test(t))
    return { tool: "capture_midi", args: {} };

  // Metronome
  if (/\b(metronome|click)\b/i.test(t)) {
    const on  = /\b(on|enable|start)\b/i.test(t) && !/\boff\b/i.test(t);
    const off = /\b(off|disable|stop)\b/i.test(t);
    return { tool: "set_metronome", args: { enabled: on && !off } };
  }

  // Tempo — "set tempo to 120", "120 BPM", "tempo 120", "set the tempo to 120"
  if (/\btempo\b/i.test(t) || /\b\bpm\b/i.test(t) || /^\d{3}\b/.test(t)) {
    const n = t.match(/(?:to |the tempo |tempo )?(\d{3})/i)?.[1]
              || t.match(/(\d{3})\s*bpm/i)?.[1]
              || num(t);
    if (n !== null) return { tool: "set_tempo", args: { tempo: parseInt(n) } };
  }

  // Track mute/solo/arm — "mute track 2", "unsolo track 1", "disarm track 3"
  const muteMatch = t.match(/\b(mute|unmute)\b.*(?:track |tr )?(\d+)/i);
  if (muteMatch) return { tool: "set_track_mute", args: { track_index: parseInt(muteMatch[2]) - 1, muted: !/\bunmute\b/i.test(t) } };
  const soloMatch = t.match(/\b(solo|unsolo)\b.*(?:track |tr )?(\d+)/i);
  if (soloMatch) return { tool: "set_track_solo", args: { track_index: parseInt(soloMatch[2]) - 1, soloed: !/\bunsolo\b/i.test(t) } };
  const armMatch  = t.match(/\b(arm|disarm)\b.*(?:track |tr )?(\d+)/i);
  if (armMatch)   return { tool: "set_track_arm",   args: { track_index: parseInt(armMatch[2]) - 1, armed: !/\bdisarm\b/i.test(t) } };

  // Track volume — "track 2 volume -6", "set track 1 to -3dB"
  const volMatch = t.match(/(?:track |tr )(\d+).*volume.*?(?:to\s*)?(-?\d+(?:\.\d+)?)\s*(?:db|dB)?$/i)
                 || t.match(/volume.*?(?:track |tr )(\d+).*?(?:to\s*)?(-?\d+(?:\.\d+)?)\s*(?:db|dB)?$/i);
  if (volMatch) return { tool: "set_track_volume", args: { track_index: parseInt(volMatch[1]) - 1, volume_db: parseFloat(volMatch[2]) } };

  // Track pan — "pan track 2 left", "set track 1 pan to 0.5"
  if (/\bpan\b/i.test(t)) {
    const panLeft  = /\bleft\b/i.test(t) ? -1 : null;
    const panRight = /\bright\b/i.test(t) ? 1  : null;
    const panVal   = t.match(/pan\s+(?:to\s*)?(-?\d+(?:\.\d+)?)/i)?.[1];
    const tIdx     = t.match(/(?:track |tr )(\d+)/i)?.[1];
    if (panLeft !== null || panRight !== null)
      return { tool: "set_track_pan", args: { track_index: tIdx ? parseInt(tIdx) - 1 : 0, pan: panLeft ?? panRight } };
    if (panVal !== null)
      return { tool: "set_track_pan", args: { track_index: tIdx ? parseInt(tIdx) - 1 : 0, pan: parseFloat(panVal) } };
  }

  // Scene — "fire scene 1", "launch scene 3"
  const sceneMatch = t.match(/(?:fire|launch|play)\s+scene\s+(\d+)/i);
  if (sceneMatch) return { tool: "fire_scene", args: { scene_index: parseInt(sceneMatch[1]) - 1 } };

  // Clip — "fire clip 2 on track 3", "stop clip 1 track 2"
  const fireClipMatch = t.match(/fire.*clip\s+(\d+).*(?:track |tr )(\d+)/i)
                      || t.match(/(?:track |tr )(\d+).*fire.*clip\s+(\d+)/i);
  if (fireClipMatch) return { tool: "fire_clip", args: { track_index: parseInt(fireClipMatch[1]) - 1, clip_index: parseInt(fireClipMatch[2]) - 1 } };

  const stopClipMatch = t.match(/stop.*clip\s+(\d+).*(?:track |tr )(\d+)/i)
                     || t.match(/(?:track |tr )(\d+).*stop.*clip\s+(\d+)/i);
  if (stopClipMatch) return { tool: "stop_clip", args: { track_index: parseInt(stopClipMatch[1]) - 1, clip_index: parseInt(stopClipMatch[2]) - 1 } };

  // Create track — "create a midi track", "add audio track"
  if (/\b(create|add|make)\b/i.test(t)) {
    if (/\bmidi\b/i.test(t)) return { tool: "create_midi_track",  args: { index: -1 } };
    if (/\baudio\b/i.test(t)) return { tool: "create_audio_track", args: { index: -1 } };
  }

  // Loop — "loop 1 to 4", "set loop from 2 to 8"
  const loopMatch = t.match(/(?:loop|set loop).*?(\d+(?:\.\d+)?).*(?:to|until|end).*?(\d+(?:\.\d+)?)/i);
  if (loopMatch) return { tool: "set_arrangement_loop", args: { start: parseFloat(loopMatch[1]), end: parseFloat(loopMatch[2]), enabled: true } };

  // Jump — "jump to 16", "go to beat 32"
  if (/\b(jump|go to|seek)\b.*?(\d+(?:\.\d+)?)/i.test(t)) {
    const j = t.match(/(\d+(?:\.\d+)?)/);
    if (j) return { tool: "jump_to_time", args: { time: parseFloat(j[1]) } };
  }

  return null; // fall through to LLM
}

// ── execute a single command ───────────────────────────────────────────────
async function execOne(toolName, args, rid) {
  const t = COMMAND_MAP[toolName];
  if (!t) return { tool: toolName, args, error: "unknown tool" };
  try {
    const [type, params] = t(args);
    if (!UPSTREAM_ABLETON_COMMANDS.has(type)) {
      logger.warn(`[${rid}] command may need extended AbletonMCP: ${type}`, rid);
    }
    logger.info(`[${rid}] → ableton: ${type} ${JSON.stringify(params)}`, rid);
    const r = await abletonSend(type, params);
    logger.info(`[${rid}] ← ableton: ${type} ok`, rid);
    return { tool: toolName, args, ableton: r };
  } catch (e) {
    logger.error(`[${rid}] tool ${toolName} failed: ${e.message}`, rid);
    return { tool: toolName, args, error: e.message };
  }
}

// ── main pipeline ──────────────────────────────────────────────────────────
async function processAudio(audioBytes, rid) {
  const started = Date.now();
  rid = rid || logger.rid();
  logger.info(`[${rid}] listen: audio ${audioBytes.length} bytes`, rid);

  const transcript = await transcribe(audioBytes, rid);
  if (!transcript) {
    return { request_id: rid, transcript: "", actions: [], assistant: "(no speech detected)", duration_ms: Date.now() - started };
  }
  logger.info(`[${rid}] transcript: "${transcript}"`, rid);
  return runCommand(transcript, rid, started);
}

async function processCommand(text, rid) {
  const started = Date.now();
  rid = rid || logger.rid();
  logger.info(`[${rid}] command: "${text}"`, rid);
  return runCommand(text, rid, started);
}

async function runCommand(text, rid, started) {
  // 1. Try direct dispatch (no LLM latency)
  const direct = tryDirectParse(text);
  if (direct) {
    logger.info(`[${rid}] direct dispatch: ${direct.tool}`, rid);
    const result = await execOne(direct.tool, direct.args, rid);
    return {
      request_id: rid,
      transcript: text,
      actions: [result],
      assistant: result.error ? "" : `${direct.tool} ok`,
      duration_ms: Date.now() - started,
    };
  }

  // 2. Fall through to LLM
  logger.debug(`[${rid}] no direct match — calling LLM`, rid);
  const resp  = await plan(text, rid);
  const calls = extractToolCalls(resp);
  if (!calls.length) {
    const text2 = (resp.message?.content || "").trim();
    logger.info(`[${rid}] no tool calls — assistant: ${text2}`, rid);
    return { request_id: rid, transcript: text, actions: [], assistant: text2, duration_ms: Date.now() - started };
  }

  const results = await Promise.all(calls.map(c => execOne(c.name, c.arguments, rid)));
  const errors  = results.filter(r => r.error);
  return {
    request_id: rid,
    transcript: text,
    actions: results,
    assistant: errors.length === 0
      ? (results.map(r => r.tool).join(", ") || "ok")
      : `${results.length - errors.length}/${results.length} succeeded`,
    duration_ms: Date.now() - started,
  };
}

function toolStatus() {
  return Object.entries(COMMAND_MAP).map(([toolName, translate]) => {
    let command = toolName;
    try {
      command = translate({ tempo: 120, enabled: true, index: -1, track_index: 0, volume_db: -6, pan: 0, muted: true, soloed: true, armed: true, clip_index: 0, scene_index: 0, start: 0, end: 4, time: 0 })[0];
    } catch {}
    return { tool: toolName, ableton_command: command, upstream_supported: UPSTREAM_ABLETON_COMMANDS.has(command) };
  });
}

module.exports = { processAudio, processCommand, toolStatus, COMMAND_MAP, UPSTREAM_ABLETON_COMMANDS, tryDirectParse };

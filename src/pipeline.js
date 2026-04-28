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

function optionalIndex(v, name) {
  return v === undefined || v === null ? -1 : intValue(v, name, -1);
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

function toolStatus() {
  return Object.entries(COMMAND_MAP).map(([toolName, translate]) => {
    let command = toolName;
    try {
      command = translate({ tempo: 120, enabled: true, index: -1, track_index: 0, volume_db: -6, pan: 0, muted: true, soloed: true, armed: true, clip_index: 0, scene_index: 0, start: 0, end: 4, time: 0 })[0];
    } catch {}
    return { tool: toolName, ableton_command: command, upstream_supported: UPSTREAM_ABLETON_COMMANDS.has(command) };
  });
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

  const resp  = await plan(transcript, rid);
  const calls = extractToolCalls(resp);
  if (!calls.length) {
    const text = (resp.message?.content || "").trim();
    logger.info(`[${rid}] no tool calls — assistant: ${text}`, rid);
    return { request_id: rid, transcript, actions: [], assistant: text, duration_ms: Date.now() - started };
  }

  let actions = [];
  const results = await Promise.all(calls.map(async (c) => {
    const t = COMMAND_MAP[c.name];
    if (!t) return { tool: c.name, args: c.arguments, error: "unknown tool" };
    try {
      const [type, params] = t(c.arguments);
      if (!UPSTREAM_ABLETON_COMMANDS.has(type)) {
        logger.warn(`[${rid}] command may need extended AbletonMCP: ${type}`, rid);
      }
      logger.info(`[${rid}] → ableton: ${type} ${JSON.stringify(params)}`, rid);
      const r = await abletonSend(type, params);
      logger.info(`[${rid}] ← ableton: ${type} ok`, rid);
      return { tool: c.name, args: c.arguments, ableton: r };
    } catch (e) {
      logger.error(`[${rid}] tool ${c.name} failed: ${e.message}`, rid);
      return { tool: c.name, args: c.arguments, error: e.message };
    }
  }));
  actions.push(...results);

  return { request_id: rid, transcript, actions, duration_ms: Date.now() - started };
}

async function processCommand(text, rid) {
  const started = Date.now();
  rid = rid || logger.rid();
  logger.info(`[${rid}] command: "${text}"`, rid);

  const resp  = await plan(text, rid);
  const calls = extractToolCalls(resp);
  if (!calls.length) {
    const text2 = (resp.message?.content || "").trim();
    logger.info(`[${rid}] no tool calls — assistant: ${text2}`, rid);
    return { request_id: rid, transcript: text, actions: [], assistant: text2, duration_ms: Date.now() - started };
  }

  let actions = [];
  const results = await Promise.all(calls.map(async (c) => {
    const t = COMMAND_MAP[c.name];
    if (!t) return { tool: c.name, args: c.arguments, error: "unknown tool" };
    try {
      const [type, params] = t(c.arguments);
      if (!UPSTREAM_ABLETON_COMMANDS.has(type)) {
        logger.warn(`[${rid}] command may need extended AbletonMCP: ${type}`, rid);
      }
      logger.info(`[${rid}] → ableton: ${type} ${JSON.stringify(params)}`, rid);
      const r = await abletonSend(type, params);
      logger.info(`[${rid}] ← ableton: ${type} ok`, rid);
      return { tool: c.name, args: c.arguments, ableton: r };
    } catch (e) {
      logger.error(`[${rid}] tool ${c.name} failed: ${e.message}`, rid);
      return { tool: c.name, args: c.arguments, error: e.message };
    }
  }));
  actions.push(...results);

  return { request_id: rid, transcript: text, actions, duration_ms: Date.now() - started };
}

module.exports = { processAudio, processCommand, toolStatus, COMMAND_MAP, UPSTREAM_ABLETON_COMMANDS };

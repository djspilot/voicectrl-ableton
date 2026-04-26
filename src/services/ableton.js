"use strict";

const net   = require("node:net");
const config = require("../config");
const logger = require("../logger");

// ── session socket (keepalive within one VoiceCtrl session) ───────────────
let sock     = null;
let sockBusy = false;

function isConnected() {
  return sock && !sock.destroyed && sock.readyState === "open";
}

function connect() {
  return new Promise((resolve, reject) => {
    if (isConnected()) { resolve(); return; }
    const s = net.createConnection(config.ABLETON_PORT, config.ABLETON_HOST);
    s.setTimeout(config.ABLETON_TIMEOUT);
    s.on("connect", () => { sock = s; resolve(); });
    s.on("timeout", () => { s.destroy(); reject(new Error("connection timeout")); });
    s.on("error",   e  => { sock = null; reject(e); });
    s.on("close",   () => { sock = null; });
  });
}

// ── send once (opens fresh connection, keeps it open for next call) ────────
function abletonSend(type, params = {}) {
  return new Promise(async (resolve, reject) => {
    let buf = "";

    async function trySend() {
      await connect();
      const payload = JSON.stringify({ type, params });
      let done = false;

      const onData = (d) => {
        buf += d.toString("utf8");
        try {
          const r = JSON.parse(buf);
          done = true;
          sock.removeListener("data", onData);
          if (r?.status && r.status !== "success") {
            reject(new Error(`AbletonMCP ${type}: ${r.message || JSON.stringify(r)}`));
          } else {
            resolve(r);
          }
        } catch { /* incomplete */ }
      };

      sock.on("data", onData);
      sock.write(payload);

      // safety: destroy after timeout if response never completes
      const timeoutId = setTimeout(() => {
        if (!done) {
          sock.removeListener("data", onData);
          sock.destroy();
          reject(new Error(`command timeout (${config.ABLETON_TIMEOUT}ms): ${type}`));
        }
      }, config.ABLETON_TIMEOUT + 500);

      sock.once("close", () => clearTimeout(timeoutId));
    }

    try {
      await trySend();
    } catch (e) {
      // one reconnect attempt on connection failure
      if (!isConnected() && (e.message.includes("connection") || e.message.includes("timeout"))) {
        logger.warn("AbletonMCP reconnecting after: " + e.message);
        sock = null;
        try { await trySend(); return; }
        catch (e2) {
          reject(new Error(`${e.message} → reconnect failed: ${e2.message}`));
          return;
        }
      }
      reject(e);
    }
  });
}

async function abletonHealth() {
  try {
    const r = await abletonSend("health_check");
    return { ok: r.status === "success", response: r };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { abletonSend, abletonHealth };

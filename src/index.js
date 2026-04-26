"use strict";

const config = require("./config");
const logger    = require("./logger");
const { server } = require("./server");

server.listen(config.PORT, "127.0.0.1", () => {
  logger.info(`VoiceCtrl listening on 127.0.0.1:${config.PORT}`, null);
});

server.on("error", e => {
  logger.error(`HTTP listen failed: ${e.message} (port ${config.PORT})`, null);
});

// ── Max handlers (expose to device) ─────────────────────────────────────────
let Max;
try { Max = require("max-api"); }
catch { Max = { addHandler: () => {}, outlet: () => {}, post: () => console.log(...arguments) }; }

Max.addHandler("status", async () => {
  const { abletonHealth } = require("./services/ableton");
  Max.outlet("ableton", (await abletonHealth()).ok ? 1 : 0);
});

Max.addHandler("say", async (...words) => {
  const { processCommand } = require("./pipeline");
  try {
    const r = await processCommand(words.join(" "));
    Max.outlet("done", JSON.stringify(r));
  } catch (e) {
    logger.error("say failed: " + e.message);
  }
});

// ── graceful shutdown ─────────────────────────────────────────────────────
process.on("SIGTERM", () => { try { server.close(); } catch {} ; process.exit(0); });
process.on("SIGINT",  () => { try { server.close(); } catch {} ; process.exit(0); });

// ── crash handlers ─────────────────────────────────────────────────────────
process.on("uncaughtException", (e) => {
  logger.error(`UNCAUGHT: ${e.stack || e.message}`);
  try { server.close(); } catch {} ;
  process.exit(1);
});

process.on("unhandledRejection", (e) => {
  logger.error(`UNHANDLED REJECTION: ${e}`);
  try { server.close(); } catch {} ;
  process.exit(1);
});

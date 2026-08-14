"use strict";

const fs = require("fs");
const path = require("path");

function dataDir() {
  return process.env.RAILWAY_VOLUME_MOUNT_PATH
    || process.env.DATA_DIR
    || path.join(process.cwd(), "data");
}

function flowsDir() {
  return path.join(dataDir(), "flows");
}

function ensureDirs() {
  fs.mkdirSync(flowsDir(), { recursive: true });
}

function flowPath(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid flow id");
  return path.join(flowsDir(), id + ".json");
}

function readFlow(id) {
  const p = flowPath(id);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeFlow(id, payload) {
  const tmp = flowPath(id) + ".tmp";
  const dest = flowPath(id);
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
  fs.renameSync(tmp, dest);
}

function deleteFlow(id) {
  const p = flowPath(id);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function emptyDoc(name) {
  return {
    version: 2,
    name: name || "Untitled",
    cam: { x: 0, y: 0, scale: 1 },
    objects: [],
  };
}

module.exports = { dataDir, flowsDir, ensureDirs, readFlow, writeFlow, deleteFlow, emptyDoc };

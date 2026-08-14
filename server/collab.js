"use strict";

const { WebSocketServer } = require("ws");
const auth = require("./auth");
const db = require("./db");
const storage = require("./storage");

const COLORS = ["#6ea8ff", "#5ce1a6", "#ffd166", "#ff8f6b", "#ff6b9d", "#b18cff", "#e8edf5"];

function colorFor(id) {
  let h = 0;
  const s = String(id || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

const rooms = new Map();

function room(flowId) {
  let r = rooms.get(flowId);
  if (!r) {
    r = { clients: new Set(), doc: null, persistTimer: null };
    rooms.set(flowId, r);
  }
  return r;
}

function schedulePersist(flowId) {
  const r = rooms.get(flowId);
  if (!r || !r.doc) return;
  clearTimeout(r.persistTimer);
  r.persistTimer = setTimeout(() => {
    try {
      storage.writeFlow(flowId, r.doc);
    } catch (e) {
      console.error("persist failed", flowId, e.message);
    }
  }, 800);
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast(flowId, msg, except) {
  const r = rooms.get(flowId);
  if (!r) return;
  const raw = JSON.stringify(msg);
  for (const c of r.clients) {
    if (c !== except && c.readyState === 1) c.send(raw);
  }
}

function presence(flowId) {
  const r = rooms.get(flowId);
  if (!r) return [];
  const out = [];
  for (const c of r.clients) {
    if (!c.user) continue;
    out.push({
      id: c.user.id,
      name: c.user.name,
      color: c.color,
      x: c.cursor ? c.cursor.x : null,
      y: c.cursor ? c.cursor.y : null,
    });
  }
  return out;
}

function leave(ws) {
  const flowId = ws.flowId;
  if (!flowId) return;
  const r = rooms.get(flowId);
  if (!r) return;
  r.clients.delete(ws);
  ws.flowId = null;
  broadcast(flowId, { type: "presence", peers: presence(flowId) });
  if (!r.clients.size) {
    if (r.doc) {
      try { storage.writeFlow(flowId, r.doc); } catch (e) { /* ignore */ }
    }
    clearTimeout(r.persistTimer);
    rooms.delete(flowId);
  }
}

async function join(ws, flowId) {
  if (!flowId) return;
  const exists = await db.query("SELECT id, name FROM flows WHERE id = $1", [flowId]);
  if (!exists.rows[0]) {
    send(ws, { type: "error", error: "Flow not found" });
    return;
  }
  if (ws.flowId) leave(ws);
  const r = room(flowId);
  if (!r.doc) r.doc = storage.readFlow(flowId) || storage.emptyDoc(exists.rows[0].name);
  ws.flowId = flowId;
  r.clients.add(ws);
  send(ws, { type: "joined", flowId, doc: r.doc, peers: presence(flowId) });
  broadcast(flowId, { type: "presence", peers: presence(flowId) }, ws);
}

function attach(server) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", async (ws, req) => {
    const payload = auth.verifyToken(auth.tokenFromReq(req));
    if (!payload || !payload.uid) {
      ws.close(4401, "auth");
      return;
    }
    const user = db.publicUser(await auth.userById(payload.uid));
    if (!user) {
      ws.close(4401, "auth");
      return;
    }
    ws.user = user;
    ws.color = colorFor(user.id);
    ws.cursor = null;
    send(ws, { type: "hello", user: { ...user, color: ws.color } });

    ws.on("message", async (buf) => {
      let msg;
      try { msg = JSON.parse(String(buf)); } catch (e) { return; }
      if (!msg || typeof msg !== "object") return;

      if (msg.type === "join") {
        await join(ws, msg.flowId);
        return;
      }
      if (msg.type === "leave") {
        leave(ws);
        return;
      }
      if (!ws.flowId) return;

      if (msg.type === "cursor") {
        ws.cursor = { x: Number(msg.x) || 0, y: Number(msg.y) || 0 };
        broadcast(ws.flowId, {
          type: "cursor",
          id: user.id,
          name: user.name,
          color: ws.color,
          x: ws.cursor.x,
          y: ws.cursor.y,
        }, ws);
        return;
      }

      if (msg.type === "doc") {
        const r = rooms.get(ws.flowId);
        if (!r) return;
        const objects = Array.isArray(msg.objects) ? msg.objects : [];
        const name = typeof msg.name === "string" ? msg.name.slice(0, 80) : (r.doc && r.doc.name) || "Untitled";
        const cam = msg.cam && typeof msg.cam === "object" ? msg.cam : (r.doc && r.doc.cam) || { x: 0, y: 0, scale: 1 };
        r.doc = { version: 2, name, cam, objects };
        schedulePersist(ws.flowId);
        db.query("UPDATE flows SET name = $1, updated_at = now() WHERE id = $2", [name, ws.flowId]).catch(() => {});
        broadcast(ws.flowId, {
          type: "doc",
          from: user.id,
          name,
          cam,
          objects,
        }, ws);
      }
    });

    ws.on("close", () => leave(ws));
    ws.on("error", () => leave(ws));
  });

  return wss;
}

function liveDoc(flowId) {
  const r = rooms.get(flowId);
  return r && r.doc ? r.doc : null;
}

function setLiveDoc(flowId, doc) {
  const r = rooms.get(flowId);
  if (r) r.doc = doc;
}

module.exports = { attach, liveDoc, setLiveDoc };

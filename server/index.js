"use strict";

const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const http = require("http");

function loadEnv() {
  try {
    const fs = require("fs");
    const envPath = path.join(__dirname, "..", ".env");
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 1) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (process.env[k] == null) process.env[k] = v;
    }
  } catch (e) { /* ignore */ }
}

loadEnv();

const db = require("./db");
const auth = require("./auth");
const storage = require("./storage");
const collab = require("./collab");

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "8mb" }));
app.use(cookieParser());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/status", async (_req, res) => {
  try {
    const n = await auth.userCount();
    res.json({
      inviteRequired: n > 0,
      firstAccount: n === 0,
    });
  } catch (e) {
    res.status(500).json({ error: "Database unavailable" });
  }
});

app.post("/api/register", async (req, res) => {
  try {
    const email = auth.normalizeEmail(req.body && req.body.email);
    const password = String((req.body && req.body.password) || "");
    const name = String((req.body && req.body.name) || "").trim().slice(0, 40) || email.split("@")[0];
    const invite = (req.body && req.body.invite) || "";
    if (!auth.validEmail(email)) return res.status(400).json({ error: "Enter a valid email" });
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });

    const existing = await db.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows[0]) return res.status(409).json({ error: "That email is already registered" });

    const n = await auth.userCount();
    if (n > 0) {
      const used = await auth.consumeInvite(invite);
      if (!used.ok) return res.status(403).json({ error: used.error });
    }

    const id = auth.uid();
    const hash = await auth.bcrypt.hash(password, 12);
    await db.query(
      "INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, $3, $4)",
      [id, email, hash, name]
    );
    const user = { id, email, name };
    auth.setSession(res, user);
    res.json({ user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not create account" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const email = auth.normalizeEmail(req.body && req.body.email);
    const password = String((req.body && req.body.password) || "");
    const r = await db.query("SELECT id, email, name, password_hash FROM users WHERE email = $1", [email]);
    const row = r.rows[0];
    if (!row) return res.status(401).json({ error: "Email or password is wrong" });
    const ok = await auth.bcrypt.compare(password, row.password_hash);
    if (!ok) return res.status(401).json({ error: "Email or password is wrong" });
    const user = db.publicUser(row);
    auth.setSession(res, user);
    res.json({ user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not sign in" });
  }
});

app.post("/api/logout", (req, res) => {
  auth.clearSession(res);
  res.json({ ok: true });
});

app.get("/api/me", auth.requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.get("/api/invites", auth.requireAuth, async (req, res) => {
  const r = await db.query(
    "SELECT code, max_uses, use_count, created_at FROM invite_codes WHERE created_by = $1 ORDER BY created_at DESC LIMIT 40",
    [req.user.id]
  );
  res.json({ invites: r.rows });
});

app.post("/api/invites", auth.requireAuth, async (req, res) => {
  const code = auth.makeInviteCode();
  const id = auth.uid();
  await db.query(
    "INSERT INTO invite_codes (id, code, created_by, max_uses) VALUES ($1, $2, $3, 1)",
    [id, code, req.user.id]
  );
  res.json({ code });
});

app.get("/api/flows", auth.requireAuth, async (_req, res) => {
  const r = await db.query(`
    SELECT f.id, f.name, f.updated_at, f.created_at, u.email AS owner_email, u.name AS owner_name
    FROM flows f
    LEFT JOIN users u ON u.id = f.owner_id
    ORDER BY f.updated_at DESC
  `);
  res.json({ flows: r.rows });
});

app.post("/api/flows", auth.requireAuth, async (req, res) => {
  const id = auth.uid();
  const name = String((req.body && req.body.name) || "Untitled").trim().slice(0, 80) || "Untitled";
  const incoming = req.body && req.body.data;
  const doc = incoming && typeof incoming === "object"
    ? { version: 2, name: incoming.name || name, cam: incoming.cam || { x: 0, y: 0, scale: 1 }, objects: incoming.objects || [] }
    : storage.emptyDoc(name);
  doc.name = name;
  await db.query(
    "INSERT INTO flows (id, owner_id, name) VALUES ($1, $2, $3)",
    [id, req.user.id, name]
  );
  storage.writeFlow(id, doc);
  res.json({ id, name, data: doc });
});

app.get("/api/flows/:id", auth.requireAuth, async (req, res) => {
  const r = await db.query("SELECT id, name, owner_id, updated_at FROM flows WHERE id = $1", [req.params.id]);
  if (!r.rows[0]) return res.status(404).json({ error: "Flow not found" });
  const live = collab.liveDoc(req.params.id);
  const data = live || storage.readFlow(req.params.id) || storage.emptyDoc(r.rows[0].name);
  res.json({ ...r.rows[0], data });
});

app.put("/api/flows/:id", auth.requireAuth, async (req, res) => {
  const r = await db.query("SELECT id, name FROM flows WHERE id = $1", [req.params.id]);
  if (!r.rows[0]) return res.status(404).json({ error: "Flow not found" });
  const name = String((req.body && req.body.name) || r.rows[0].name).trim().slice(0, 80) || r.rows[0].name;
  const incoming = req.body && req.body.data;
  const live = collab.liveDoc(req.params.id);
  const doc = incoming && typeof incoming === "object"
    ? { version: 2, name, cam: incoming.cam || { x: 0, y: 0, scale: 1 }, objects: incoming.objects || [] }
    : (live || storage.readFlow(req.params.id) || storage.emptyDoc(name));
  doc.name = name;
  await db.query("UPDATE flows SET name = $1, updated_at = now() WHERE id = $2", [name, req.params.id]);
  storage.writeFlow(req.params.id, doc);
  collab.setLiveDoc(req.params.id, doc);
  res.json({ id: req.params.id, name, data: doc });
});

app.delete("/api/flows/:id", auth.requireAuth, async (req, res) => {
  const r = await db.query("SELECT id, owner_id FROM flows WHERE id = $1", [req.params.id]);
  if (!r.rows[0]) return res.status(404).json({ error: "Flow not found" });
  if (r.rows[0].owner_id && r.rows[0].owner_id !== req.user.id) {
    return res.status(403).json({ error: "Only the owner can delete this flow" });
  }
  await db.query("DELETE FROM flows WHERE id = $1", [req.params.id]);
  storage.deleteFlow(req.params.id);
  res.json({ ok: true });
});

const root = path.join(__dirname, "..");
app.use("/js", express.static(path.join(root, "js")));
app.use("/css", express.static(path.join(root, "css")));
app.get("/", (_req, res) => res.sendFile(path.join(root, "index.html")));

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required (Railway Postgres).");
    process.exit(1);
  }
  storage.ensureDirs();
  await db.migrate();
  const port = Number(process.env.PORT) || 3333;
  const server = http.createServer(app);
  collab.attach(server);
  server.listen(port, "0.0.0.0", () => {
    console.log("Flow listening on :" + port);
    console.log("Data dir:", storage.dataDir());
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

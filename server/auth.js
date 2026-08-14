"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("./db");
const storage = require("./storage");

const COOKIE = "flow_sid";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
let cachedSecret = null;

function secret() {
  if (cachedSecret) return cachedSecret;
  const fromEnv = (process.env.SESSION_SECRET || "").trim();
  if (fromEnv && fromEnv !== "change-me-to-a-long-random-string") {
    cachedSecret = fromEnv;
    return cachedSecret;
  }
  const file = path.join(storage.dataDir(), ".session-secret");
  try {
    if (fs.existsSync(file)) {
      const stored = fs.readFileSync(file, "utf8").trim();
      if (stored) {
        cachedSecret = stored;
        return cachedSecret;
      }
    }
  } catch (e) { /* ignore */ }
  cachedSecret = crypto.randomBytes(32).toString("hex");
  try {
    storage.ensureDirs();
    fs.writeFileSync(file, cachedSecret, { encoding: "utf8", mode: 0o600 });
    console.warn("SESSION_SECRET was not set; generated one at", file);
  } catch (e) {
    console.warn("SESSION_SECRET was not set and could not be saved; sessions reset on restart");
  }
  return cachedSecret;
}

function uid() {
  return crypto.randomUUID();
}

function cookieOpts(req) {
  const proto = String((req && (req.get && req.get("x-forwarded-proto") || (req.headers && req.headers["x-forwarded-proto"]))) || (req && req.protocol) || "");
  const https = proto.includes("https") || !!(req && req.secure);
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: https,
    maxAge: MAX_AGE_MS,
    path: "/",
  };
}

function sign(user) {
  return jwt.sign(
    { uid: user.id, email: user.email, name: user.name },
    secret(),
    { expiresIn: "30d" }
  );
}

function verifyToken(token) {
  if (!token) return null;
  try {
    return jwt.verify(token, secret());
  } catch (e) {
    return null;
  }
}

function tokenFromReq(req) {
  if (req.cookies && req.cookies[COOKIE]) return req.cookies[COOKIE];
  const auth = req.headers && req.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) return auth.slice(7);
  if (req.url) {
    try {
      const u = new URL(req.url, "http://localhost");
      if (u.searchParams.get("token")) return u.searchParams.get("token");
    } catch (e) { /* ignore */ }
  }
  const raw = (req.headers && req.headers.cookie) || "";
  const m = raw.match(new RegExp("(?:^|; )" + COOKIE + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : null;
}

function setSession(res, user, req) {
  res.cookie(COOKIE, sign(user), cookieOpts(req));
}

function clearSession(res, req) {
  res.clearCookie(COOKIE, { ...cookieOpts(req), maxAge: 0 });
}

async function userById(id) {
  const r = await db.query("SELECT id, email, name, password_hash FROM users WHERE id = $1", [id]);
  return r.rows[0] || null;
}

async function requireAuth(req, res, next) {
  const payload = verifyToken(tokenFromReq(req));
  if (!payload || !payload.uid) {
    res.status(401).json({ error: "Sign in required" });
    return;
  }
  const user = await userById(payload.uid);
  if (!user) {
    res.status(401).json({ error: "Account not found" });
    return;
  }
  req.user = db.publicUser(user);
  next();
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function makeInviteCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let body = "";
  for (let i = 0; i < 6; i++) body += alphabet[crypto.randomInt(alphabet.length)];
  return "FLOW-" + body;
}

async function userCount() {
  const r = await db.query("SELECT COUNT(*)::int AS n FROM users");
  return r.rows[0].n;
}

async function consumeInvite(code, userId) {
  const raw = String(code || "").trim().toUpperCase();
  if (!raw) return { ok: false, error: "Invite code required" };
  const r = await db.query("SELECT * FROM invite_codes WHERE code = $1", [raw]);
  const row = r.rows[0];
  if (!row) return { ok: false, error: "Invalid invite code" };
  if (!row.flow_id) return { ok: false, error: "This invite is no longer valid" };
  const flow = await db.query("SELECT id, name, is_public FROM flows WHERE id = $1", [row.flow_id]);
  if (!flow.rows[0]) return { ok: false, error: "Flow not found" };
  if (!flow.rows[0].is_public) {
    return { ok: false, error: "That flow is not open to join right now" };
  }
  const unlimited = !row.max_uses;
  if (!unlimited && row.use_count >= row.max_uses) {
    return { ok: false, error: "Invite code already used" };
  }
  if (!unlimited) {
    const used = await db.query(
      "UPDATE invite_codes SET use_count = use_count + 1 WHERE id = $1 AND use_count < max_uses RETURNING id",
      [row.id]
    );
    if (!used.rows[0]) return { ok: false, error: "Invite code already used" };
  } else {
    await db.query("UPDATE invite_codes SET use_count = use_count + 1 WHERE id = $1", [row.id]);
  }
  await db.addFlowMember(row.flow_id, userId);
  return { ok: true, flow: { id: flow.rows[0].id, name: flow.rows[0].name } };
}

module.exports = {
  COOKIE,
  uid,
  tokenFromReq,
  verifyToken,
  setSession,
  clearSession,
  requireAuth,
  userById,
  normalizeEmail,
  validEmail,
  makeInviteCode,
  userCount,
  consumeInvite,
  bcrypt,
};

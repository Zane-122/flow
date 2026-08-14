"use strict";

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("./db");

const COOKIE = "flow_sid";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function secret() {
  const s = process.env.SESSION_SECRET || "";
  const hosted = !!(process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === "production");
  if (hosted && (!s || s === "change-me-to-a-long-random-string")) {
    throw new Error("SESSION_SECRET is required in production");
  }
  return s || "dev-only-secret-do-not-use-in-prod";
}

function uid() {
  return crypto.randomUUID();
}

function cookieOpts() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" || process.env.RAILWAY_ENVIRONMENT != null,
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

function setSession(res, user) {
  res.cookie(COOKIE, sign(user), cookieOpts());
}

function clearSession(res) {
  res.clearCookie(COOKIE, { ...cookieOpts(), maxAge: 0 });
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
  if (row.use_count >= row.max_uses) return { ok: false, error: "Invite code already used" };
  const used = await db.query(
    "UPDATE invite_codes SET use_count = use_count + 1 WHERE id = $1 AND use_count < max_uses RETURNING id",
    [row.id]
  );
  if (!used.rows[0]) return { ok: false, error: "Invite code already used" };
  return { ok: true };
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

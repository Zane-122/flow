"use strict";

const { Pool } = require("pg");

function pgSsl() {
  if (process.env.DATABASE_SSL === "0") return false;
  if (process.env.DATABASE_SSL === "1") return { rejectUnauthorized: false };
  const url = process.env.DATABASE_URL || "";
  if (/localhost|127\.0\.0\.1|\.railway\.internal/i.test(url)) return false;
  return { rejectUnauthorized: false };
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: pgSsl(),
});

async function query(text, params) {
  return pool.query(text, params);
}

async function migrate() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS invite_codes (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      max_uses INT NOT NULL DEFAULT 1,
      use_count INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS flows (
      id TEXT PRIMARY KEY,
      owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT 'Untitled',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS flows_updated_idx ON flows (updated_at DESC);
    CREATE TABLE IF NOT EXISTS flow_members (
      flow_id TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (flow_id, user_id)
    );
  `);
  await query(`ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS flow_id TEXT REFERENCES flows(id) ON DELETE CASCADE`);
  await query(`ALTER TABLE flows ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false`);
  await query(`
    INSERT INTO flow_members (flow_id, user_id)
    SELECT id, owner_id FROM flows WHERE owner_id IS NOT NULL
    ON CONFLICT DO NOTHING
  `);
}

async function canAccessFlow(userId, flowId) {
  const r = await query(
    `SELECT 1 FROM flows f
     WHERE f.id = $2 AND (
       f.owner_id = $1
       OR EXISTS (SELECT 1 FROM flow_members m WHERE m.flow_id = f.id AND m.user_id = $1)
     )`,
    [userId, flowId]
  );
  return !!r.rows[0];
}

async function addFlowMember(flowId, userId) {
  await query(
    "INSERT INTO flow_members (flow_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [flowId, userId]
  );
}

function publicUser(row) {
  if (!row) return null;
  return { id: row.id, email: row.email, name: row.name || row.email.split("@")[0] };
}

module.exports = { pool, query, migrate, publicUser, canAccessFlow, addFlowMember };

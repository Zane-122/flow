"use strict";

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "0" ? false : (process.env.DATABASE_URL || "").includes("localhost") ? false : { rejectUnauthorized: false },
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
  `);
}

function publicUser(row) {
  if (!row) return null;
  return { id: row.id, email: row.email, name: row.name || row.email.split("@")[0] };
}

module.exports = { pool, query, migrate, publicUser };

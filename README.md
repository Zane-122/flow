# Flow — collaborative flowchart maker

A fluid flowchart canvas with **accounts**, **invite codes**, **live collaborator cursors**, and **cloud saves**. One Node service, Postgres for users, a Railway volume for JSON files.

## Local run

You need Node 20+ and Postgres.

```bash
cd tools/flow
cp .env.example .env
# point DATABASE_URL at local Postgres, then:
npm install
npm start
```

Open http://localhost:3333

The first account can register with no invite. After that, signups need an invite code generated from the account menu (top right).

## Railway

Create a project with **two pieces**:

### 1. Postgres

In the Railway project: **New → Database → PostgreSQL**.

Railway injects `DATABASE_URL` when you reference it from the app service.

### 2. App service

- New service from this repo
- **Root Directory:** `tools/flow`
- Builder: Nixpacks (from `railway.toml`)
- Start command: `npm start`

**Volume (required for saved flows):**

- Add a volume to the app service
- Mount path: `/data`
- Railway then sets `RAILWAY_VOLUME_MOUNT_PATH=/data` (the server uses that automatically)

**Variables on the app service:**

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Reference the Postgres service variable |
| `SESSION_SECRET` | yes | Long random string (cookie signing) |
| `PORT` | auto | Railway injects this |
| `DATA_DIR` | no | Defaults to the volume mount, then `./data` |

Generate a secret:

```bash
openssl rand -hex 32
```

Generate a public URL on the app service. Replicas must stay at **1** (volumes cannot be shared across replicas).

### First login

1. Open the public URL
2. Create the first account (email + password, no invite)
3. Use **Create invite code** in the account menu to let others join
4. **Save** writes the JSON file onto the volume; **Open** lists flows from Postgres + disk
5. Anyone in the same flow sees the others’ cursors live

## What is stored where

- **Postgres:** users (`email`, `password_hash`, `name`), invite codes, flow metadata (id, name, owner, timestamps)
- **Volume `/data/flows/{id}.json`:** the actual diagram JSON
- **Passwords:** bcrypt hashes only — never plaintext

## Collaboration

WebSocket `/ws` (cookie auth):

- Cursor positions in world coordinates, drawn for everyone else
- Diagram edits broadcast to the room (~0.5s) and persist to the volume
- Presence chips in the top-right

import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fs from "fs";

const SCHEMA_VERSION = 2;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS teams (
  name          TEXT PRIMARY KEY,
  description   TEXT,
  agent_type    TEXT,
  template_name TEXT,
  template_path TEXT,
  created_at    TEXT DEFAULT (datetime('now')),
  status        TEXT DEFAULT 'active' CHECK (status IN ('active', 'deleted'))
);

CREATE TABLE IF NOT EXISTS members (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  team_name    TEXT NOT NULL REFERENCES teams(name),
  agent_name   TEXT NOT NULL,
  agent_id     TEXT,
  agent_type   TEXT DEFAULT 'general-purpose',
  role         TEXT,
  status       TEXT DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'shutdown')),
  spawn_prompt TEXT,
  model        TEXT,
  created_at   TEXT DEFAULT (datetime('now')),
  UNIQUE(team_name, agent_name)
);

CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  team_name   TEXT NOT NULL REFERENCES teams(name),
  subject     TEXT NOT NULL,
  description TEXT NOT NULL,
  active_form TEXT,
  status      TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'deleted')),
  owner       TEXT,
  metadata    TEXT DEFAULT '{}',
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS task_deps (
  task_id     INTEGER NOT NULL REFERENCES tasks(id),
  blocked_by  INTEGER NOT NULL REFERENCES tasks(id),
  PRIMARY KEY (task_id, blocked_by)
);

CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  team_name   TEXT NOT NULL REFERENCES teams(name),
  type        TEXT NOT NULL CHECK (type IN ('message', 'broadcast', 'shutdown_request', 'shutdown_response', 'plan_approval_response')),
  sender      TEXT NOT NULL,
  recipient   TEXT,
  content     TEXT NOT NULL,
  summary     TEXT,
  request_id  TEXT,
  approve     INTEGER,
  delivered   INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- Communication: channel definitions per team
CREATE TABLE IF NOT EXISTS channels (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  team_name   TEXT NOT NULL REFERENCES teams(name),
  name        TEXT NOT NULL,
  description TEXT,
  UNIQUE(team_name, name)
);

-- Signals belonging to a channel
CREATE TABLE IF NOT EXISTS channel_signals (
  channel_id  INTEGER NOT NULL REFERENCES channels(id),
  signal      TEXT NOT NULL,
  PRIMARY KEY (channel_id, signal)
);

-- Role subscriptions to channels (with optional signal filter)
CREATE TABLE IF NOT EXISTS subscriptions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  team_name   TEXT NOT NULL REFERENCES teams(name),
  role        TEXT NOT NULL,
  channel     TEXT NOT NULL,
  signal      TEXT,
  UNIQUE(team_name, role, channel, signal)
);

-- Emission permissions per role
CREATE TABLE IF NOT EXISTS emissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  team_name   TEXT NOT NULL REFERENCES teams(name),
  role        TEXT NOT NULL,
  signal      TEXT NOT NULL,
  UNIQUE(team_name, role, signal)
);

-- Peer routing rules
CREATE TABLE IF NOT EXISTS peer_routes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  team_name   TEXT NOT NULL REFERENCES teams(name),
  from_role   TEXT NOT NULL,
  to_role     TEXT NOT NULL,
  via         TEXT NOT NULL DEFAULT 'direct' CHECK (via IN ('direct', 'topic', 'scope')),
  signals     TEXT DEFAULT '[]'
);

-- Signal events log
CREATE TABLE IF NOT EXISTS signal_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  team_name   TEXT NOT NULL REFERENCES teams(name),
  channel     TEXT NOT NULL,
  signal      TEXT NOT NULL,
  sender      TEXT NOT NULL,
  payload     TEXT DEFAULT '{}',
  created_at  TEXT DEFAULT (datetime('now'))
);

-- Spawn rules per team
CREATE TABLE IF NOT EXISTS spawn_rules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  team_name   TEXT NOT NULL REFERENCES teams(name),
  from_role   TEXT NOT NULL,
  to_role     TEXT NOT NULL,
  UNIQUE(team_name, from_role, to_role)
);
`;

function getDefaultDbPath(): string {
  const dir = path.join(os.homedir(), ".openteams");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "openteams.db");
}

export function createDatabase(dbPath?: string): Database.Database {
  const resolvedPath = dbPath ?? getDefaultDbPath();
  const db = new Database(resolvedPath);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(SCHEMA_SQL);

  const row = db.prepare("SELECT version FROM schema_version LIMIT 1").get() as
    | { version: number }
    | undefined;

  if (!row) {
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(
      SCHEMA_VERSION
    );
  }

  return db;
}

export function createInMemoryDatabase(): Database.Database {
  return createDatabase(":memory:");
}

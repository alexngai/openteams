import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fs from "fs";

// ---------------------------------------------------------------------------
// Migration framework
// ---------------------------------------------------------------------------
// SCHEMA_SQL is the full current schema for fresh installs.
// MIGRATIONS handles upgrades for existing databases.
//
// When adding a new schema change:
//   1. Update SCHEMA_SQL to include the change (for fresh installs)
//   2. Add a Migration entry with the next version number (for existing installs)
//   3. Bump CURRENT_VERSION to match
// ---------------------------------------------------------------------------

export interface Migration {
  version: number;
  up: string;
}

export const CURRENT_VERSION = 2;

/**
 * Migrations applied incrementally to existing databases.
 * Each migration brings the schema from (version - 1) to version.
 * For now this is empty because v2 is the baseline — no users have
 * older databases. Future changes add entries here.
 */
export const MIGRATIONS: Migration[] = [
  // Example for a future change:
  // {
  //   version: 3,
  //   up: `ALTER TABLE teams ADD COLUMN some_new_col TEXT;`
  // },
];

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

/**
 * Read the current schema version from the database.
 * Returns 0 if no version row exists (fresh install).
 */
export function getSchemaVersion(db: Database.Database): number {
  const row = db
    .prepare("SELECT version FROM schema_version LIMIT 1")
    .get() as { version: number } | undefined;
  return row?.version ?? 0;
}

/**
 * Apply pending migrations to bring the database up to CURRENT_VERSION.
 * Runs inside a transaction so partial migrations are rolled back.
 */
export function applyMigrations(
  db: Database.Database,
  fromVersion: number,
  migrations: Migration[] = MIGRATIONS
): number {
  const pending = migrations
    .filter((m) => m.version > fromVersion)
    .sort((a, b) => a.version - b.version);

  if (pending.length === 0) return fromVersion;

  const targetVersion = pending[pending.length - 1].version;

  const migrate = db.transaction(() => {
    for (const migration of pending) {
      db.exec(migration.up);
    }
    db.prepare("UPDATE schema_version SET version = ?").run(targetVersion);
  });

  migrate();
  return targetVersion;
}

export function createDatabase(dbPath?: string): Database.Database {
  const resolvedPath = dbPath ?? getDefaultDbPath();
  const db = new Database(resolvedPath);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Create all tables (IF NOT EXISTS is safe for both fresh and existing DBs)
  db.exec(SCHEMA_SQL);

  const currentVersion = getSchemaVersion(db);

  if (currentVersion === 0) {
    // Fresh install — stamp with current version
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(
      CURRENT_VERSION
    );
  } else if (currentVersion < CURRENT_VERSION) {
    // Existing database needs migration
    applyMigrations(db, currentVersion);
  }

  return db;
}

export function createInMemoryDatabase(): Database.Database {
  return createDatabase(":memory:");
}

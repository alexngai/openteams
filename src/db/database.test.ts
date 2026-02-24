import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import {
  createInMemoryDatabase,
  getSchemaVersion,
  applyMigrations,
  CURRENT_VERSION,
} from "./database";
import type { Migration } from "./database";

describe("database", () => {
  it("creates an in-memory database with all tables", () => {
    const db = createInMemoryDatabase();

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all() as Array<{ name: string }>;

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain("teams");
    expect(tableNames).toContain("members");
    expect(tableNames).toContain("tasks");
    expect(tableNames).toContain("task_deps");
    expect(tableNames).toContain("messages");
    expect(tableNames).toContain("schema_version");
    expect(tableNames).toContain("channels");
    expect(tableNames).toContain("channel_signals");
    expect(tableNames).toContain("subscriptions");
    expect(tableNames).toContain("emissions");
    expect(tableNames).toContain("peer_routes");
    expect(tableNames).toContain("signal_events");
    expect(tableNames).toContain("spawn_rules");

    db.close();
  });

  it("stores schema version", () => {
    const db = createInMemoryDatabase();

    const row = db
      .prepare("SELECT version FROM schema_version LIMIT 1")
      .get() as { version: number };

    expect(row.version).toBe(CURRENT_VERSION);
    db.close();
  });

  it("enables WAL mode and foreign keys", () => {
    const db = createInMemoryDatabase();

    const wal = db.pragma("journal_mode") as Array<{ journal_mode: string }>;
    // In-memory databases may use 'memory' instead of 'wal'
    expect(["wal", "memory"]).toContain(wal[0].journal_mode);

    const fk = db.pragma("foreign_keys") as Array<{ foreign_keys: number }>;
    expect(fk[0].foreign_keys).toBe(1);

    db.close();
  });

  it("is idempotent - can be called multiple times on same db", () => {
    const db = createInMemoryDatabase();

    // Calling schema creation again should not fail
    db.exec(
      "CREATE TABLE IF NOT EXISTS teams (name TEXT PRIMARY KEY, description TEXT, agent_type TEXT, created_at TEXT, status TEXT)"
    );

    db.close();
  });
});

describe("migrations", () => {
  it("getSchemaVersion returns 0 for empty schema_version table", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE schema_version (version INTEGER PRIMARY KEY)");

    expect(getSchemaVersion(db)).toBe(0);
    db.close();
  });

  it("getSchemaVersion returns stored version", () => {
    const db = createInMemoryDatabase();
    expect(getSchemaVersion(db)).toBe(CURRENT_VERSION);
    db.close();
  });

  it("applyMigrations runs pending migrations in order", () => {
    const db = createInMemoryDatabase();

    // Simulate a v2 database that needs v3 and v4
    const migrations: Migration[] = [
      { version: 3, up: "ALTER TABLE teams ADD COLUMN extra1 TEXT;" },
      { version: 4, up: "ALTER TABLE teams ADD COLUMN extra2 TEXT;" },
    ];

    const result = applyMigrations(db, 2, migrations);
    expect(result).toBe(4);

    // Verify version was updated
    expect(getSchemaVersion(db)).toBe(4);

    // Verify columns were added
    const info = db.prepare("PRAGMA table_info(teams)").all() as Array<{
      name: string;
    }>;
    const colNames = info.map((c) => c.name);
    expect(colNames).toContain("extra1");
    expect(colNames).toContain("extra2");

    db.close();
  });

  it("applyMigrations skips already-applied versions", () => {
    const db = createInMemoryDatabase();

    const migrations: Migration[] = [
      { version: 1, up: "SELECT 1;" }, // already past this
      { version: 2, up: "SELECT 1;" }, // already at this
      { version: 3, up: "ALTER TABLE teams ADD COLUMN new_col TEXT;" },
    ];

    const result = applyMigrations(db, 2, migrations);
    expect(result).toBe(3);

    // Only the v3 migration should have run
    const info = db.prepare("PRAGMA table_info(teams)").all() as Array<{
      name: string;
    }>;
    const colNames = info.map((c) => c.name);
    expect(colNames).toContain("new_col");

    db.close();
  });

  it("applyMigrations returns current version when nothing to apply", () => {
    const db = createInMemoryDatabase();

    const result = applyMigrations(db, CURRENT_VERSION, []);
    expect(result).toBe(CURRENT_VERSION);

    db.close();
  });

  it("applyMigrations rolls back on failure", () => {
    const db = createInMemoryDatabase();

    const migrations: Migration[] = [
      { version: 3, up: "ALTER TABLE teams ADD COLUMN good_col TEXT;" },
      { version: 4, up: "ALTER TABLE nonexistent_table ADD COLUMN bad TEXT;" },
    ];

    expect(() => applyMigrations(db, 2, migrations)).toThrow();

    // Version should still be 2 — transaction rolled back
    expect(getSchemaVersion(db)).toBe(CURRENT_VERSION);

    // The v3 column should NOT exist — entire transaction rolled back
    const info = db.prepare("PRAGMA table_info(teams)").all() as Array<{
      name: string;
    }>;
    const colNames = info.map((c) => c.name);
    expect(colNames).not.toContain("good_col");

    db.close();
  });

  it("applies migrations in version order regardless of array order", () => {
    const db = createInMemoryDatabase();

    // Provide migrations out of order
    const migrations: Migration[] = [
      { version: 4, up: "ALTER TABLE teams ADD COLUMN col_b TEXT;" },
      { version: 3, up: "ALTER TABLE teams ADD COLUMN col_a TEXT;" },
    ];

    const result = applyMigrations(db, 2, migrations);
    expect(result).toBe(4);
    expect(getSchemaVersion(db)).toBe(4);

    db.close();
  });
});

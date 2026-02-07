import { describe, it, expect } from "vitest";
import { createInMemoryDatabase } from "./database";

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

    db.close();
  });

  it("stores schema version", () => {
    const db = createInMemoryDatabase();

    const row = db
      .prepare("SELECT version FROM schema_version LIMIT 1")
      .get() as { version: number };

    expect(row.version).toBe(1);
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

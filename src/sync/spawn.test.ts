import { describe, it, expect } from "vitest";

import {
  decodeSpawnTaskMeta,
  encodeSpawnTaskMeta,
  isSpawnTaskMeta,
} from "./spawn";
import { SPAWN_KIND, type SpawnRequest } from "./types";

const FULL_REQ: SpawnRequest = {
  loadout: "x-openteams/loadout:sha256:" + "a".repeat(64),
  label: "executor-3",
  team: "x-openteams/team:sha256:" + "b".repeat(64),
  role: "executor",
  target: { runtime: "claude-code", placement: { zone: "edge" } },
  parent: "gsd-orchestrator",
};

const MINIMAL_REQ: SpawnRequest = {
  loadout: "x-openteams/loadout:sha256:" + "c".repeat(64),
};

describe("encodeSpawnTaskMeta", () => {
  it("includes only the discriminator and required fields for a minimal request", () => {
    const meta = encodeSpawnTaskMeta(MINIMAL_REQ);
    expect(meta).toEqual({
      kind: SPAWN_KIND,
      loadout: MINIMAL_REQ.loadout,
    });
  });

  it("propagates every optional field for a full request", () => {
    const meta = encodeSpawnTaskMeta(FULL_REQ);
    expect(meta.kind).toBe(SPAWN_KIND);
    expect(meta.loadout).toBe(FULL_REQ.loadout);
    expect(meta.label).toBe(FULL_REQ.label);
    expect(meta.team).toBe(FULL_REQ.team);
    expect(meta.role).toBe(FULL_REQ.role);
    expect(meta.target).toEqual(FULL_REQ.target);
    expect(meta.parent).toBe(FULL_REQ.parent);
  });

  it("does not include undefined optional fields", () => {
    const meta = encodeSpawnTaskMeta(MINIMAL_REQ);
    expect("label" in meta).toBe(false);
    expect("team" in meta).toBe(false);
    expect("role" in meta).toBe(false);
    expect("target" in meta).toBe(false);
    expect("parent" in meta).toBe(false);
  });
});

describe("decodeSpawnTaskMeta", () => {
  it("round-trips through encode for a full request", () => {
    const decoded = decodeSpawnTaskMeta(encodeSpawnTaskMeta(FULL_REQ));
    expect(decoded).toEqual(FULL_REQ);
  });

  it("round-trips through encode for a minimal request", () => {
    const decoded = decodeSpawnTaskMeta(encodeSpawnTaskMeta(MINIMAL_REQ));
    expect(decoded).toEqual(MINIMAL_REQ);
  });

  it("returns null when meta is not an object", () => {
    expect(decodeSpawnTaskMeta(null)).toBeNull();
    expect(decodeSpawnTaskMeta(undefined)).toBeNull();
    expect(decodeSpawnTaskMeta("string")).toBeNull();
    expect(decodeSpawnTaskMeta(42)).toBeNull();
    expect(decodeSpawnTaskMeta([])).toBeNull();
  });

  it("returns null when kind is wrong", () => {
    expect(decodeSpawnTaskMeta({ kind: "other.kind", loadout: "x" })).toBeNull();
    expect(decodeSpawnTaskMeta({ loadout: "x" })).toBeNull();
  });

  it("returns null when loadout is missing or not a string", () => {
    expect(decodeSpawnTaskMeta({ kind: SPAWN_KIND })).toBeNull();
    expect(decodeSpawnTaskMeta({ kind: SPAWN_KIND, loadout: "" })).toBeNull();
    expect(decodeSpawnTaskMeta({ kind: SPAWN_KIND, loadout: 42 })).toBeNull();
  });

  it("ignores fields with wrong types", () => {
    const decoded = decodeSpawnTaskMeta({
      kind: SPAWN_KIND,
      loadout: "x-openteams/loadout:sha256:abc",
      label: 42,           // wrong type
      role: { not: "a string" }, // wrong type
      target: "not an object",   // wrong type
      parent: undefined,
    });
    expect(decoded).toEqual({ loadout: "x-openteams/loadout:sha256:abc" });
  });

  it("preserves extension fields on target", () => {
    const decoded = decodeSpawnTaskMeta({
      kind: SPAWN_KIND,
      loadout: "x-openteams/loadout:sha256:abc",
      target: { runtime: "claude-code", custom_field: { foo: "bar" } },
    });
    expect(decoded?.target).toEqual({
      runtime: "claude-code",
      custom_field: { foo: "bar" },
    });
  });
});

describe("isSpawnTaskMeta", () => {
  it("returns true for valid meta", () => {
    expect(isSpawnTaskMeta(encodeSpawnTaskMeta(MINIMAL_REQ))).toBe(true);
    expect(isSpawnTaskMeta(encodeSpawnTaskMeta(FULL_REQ))).toBe(true);
  });

  it("returns false for invalid meta", () => {
    expect(isSpawnTaskMeta(null)).toBe(false);
    expect(isSpawnTaskMeta({ kind: "wrong" })).toBe(false);
    expect(isSpawnTaskMeta({ kind: SPAWN_KIND })).toBe(false);
  });
});

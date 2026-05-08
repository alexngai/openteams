// ─────────────────────────────────────────────────────────────
// Spawn dispatch — MAP task meta encode/decode
// ─────────────────────────────────────────────────────────────
// SpawnRequest is the application-level shape; SpawnTaskMeta is the
// wire form carried on `MAPTask.meta`. These functions translate
// between them and validate incoming wire payloads.

import {
  SPAWN_KIND,
  type SpawnRequest,
  type SpawnTarget,
  type SpawnTaskMeta,
} from "./types";

/** Build a `SpawnTaskMeta` payload from an application-level request. */
export function encodeSpawnTaskMeta(req: SpawnRequest): SpawnTaskMeta {
  const meta: SpawnTaskMeta = {
    kind: SPAWN_KIND,
    loadout: req.loadout,
  };
  if (req.label !== undefined) meta.label = req.label;
  if (req.team !== undefined) meta.team = req.team;
  if (req.role !== undefined) meta.role = req.role;
  if (req.target !== undefined) meta.target = req.target;
  if (req.parent !== undefined) meta.parent = req.parent;
  return meta;
}

/**
 * Decode a wire `meta` payload into a `SpawnRequest`.
 * Returns `null` if the payload is not a spawn task meta.
 */
export function decodeSpawnTaskMeta(meta: unknown): SpawnRequest | null {
  if (!isObject(meta)) return null;
  if (meta.kind !== SPAWN_KIND) return null;
  if (typeof meta.loadout !== "string" || meta.loadout.length === 0) return null;

  const req: SpawnRequest = { loadout: meta.loadout };

  if (typeof meta.label === "string") req.label = meta.label;
  if (typeof meta.team === "string") req.team = meta.team;
  if (typeof meta.role === "string") req.role = meta.role;
  if (typeof meta.parent === "string") req.parent = meta.parent;

  if (isObject(meta.target)) {
    const target: SpawnTarget = {};
    for (const [k, v] of Object.entries(meta.target)) {
      target[k] = v;
    }
    req.target = target;
  }

  return req;
}

/** Type guard: `meta` is a well-formed spawn task meta payload. */
export function isSpawnTaskMeta(meta: unknown): meta is SpawnTaskMeta {
  return decodeSpawnTaskMeta(meta) !== null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

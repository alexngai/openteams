// ─────────────────────────────────────────────────────────────
// Resource reference parsing & formatting
// ─────────────────────────────────────────────────────────────
// Strings of the form `<type>:<id>` for embedding resource refs
// inside other payloads (e.g. spawn task meta). For richer fetch
// surfaces, the underlying MAP `map/resources/get` call takes
// `{ type, id }` directly — this module is purely about the
// stringified embedding form.

import {
  LOADOUT_RESOURCE_TYPE,
  TEAM_RESOURCE_TYPE,
  type OpenTeamsResourceType,
  type ResourceRef,
} from "./types";

const TYPE_PATTERN = /^x-openteams\/(loadout|team)$/;
const HASH_ID_PATTERN = /^sha256:[0-9a-f]{64}$/;
// name: word characters, hyphens, slashes for namespacing.
// version: anything that isn't `:`, to accept the full semver vocabulary.
const ALIAS_ID_PATTERN = /^[A-Za-z0-9_./-]+@[^:]+$/;

/**
 * Parse a stringified resource reference. Returns `null` for any input
 * that doesn't match the expected `<type>:<id>` shape with a recognized
 * OpenTeams resource type.
 */
export function parseRef(input: string): ResourceRef | null {
  if (typeof input !== "string" || input.length === 0) return null;

  // Find the first colon that ends the type portion.
  // Type is always exactly `x-openteams/<kind>` — match it explicitly.
  const colon = input.indexOf(":");
  if (colon < 0) return null;

  const typeStr = input.slice(0, colon);
  const id = input.slice(colon + 1);

  if (!TYPE_PATTERN.test(typeStr)) return null;
  if (id.length === 0) return null;

  return { type: typeStr as OpenTeamsResourceType, id };
}

/** Format a `ResourceRef` back into its stringified form. */
export function formatRef(ref: ResourceRef): string {
  return `${ref.type}:${ref.id}`;
}

/** True if the id looks like a content hash (`sha256:<64-hex>`). */
export function isHashId(id: string): boolean {
  return HASH_ID_PATTERN.test(id);
}

/** True if the id looks like an alias (`<name>@<version>`). */
export function isAliasId(id: string): boolean {
  return ALIAS_ID_PATTERN.test(id);
}

/**
 * Split an alias id into its `(name, version)` parts.
 * Returns `null` if the id isn't an alias.
 */
export function splitAliasId(id: string): { name: string; version: string } | null {
  if (!isAliasId(id)) return null;
  const at = id.lastIndexOf("@");
  return { name: id.slice(0, at), version: id.slice(at + 1) };
}

/**
 * Convenience: build a loadout reference from a hash id (e.g. the value
 * returned by `bundleLoadout(...).id`).
 */
export function loadoutRef(id: string): string {
  return `${LOADOUT_RESOURCE_TYPE}:${id}`;
}

/** Convenience: build a team reference from a hash id. */
export function teamRef(id: string): string {
  return `${TEAM_RESOURCE_TYPE}:${id}`;
}

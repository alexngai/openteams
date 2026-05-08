import { describe, it, expect } from "vitest";

import {
  formatRef,
  isAliasId,
  isHashId,
  loadoutRef,
  parseRef,
  splitAliasId,
  teamRef,
} from "./uri";
import { LOADOUT_RESOURCE_TYPE, TEAM_RESOURCE_TYPE } from "./types";

const HASH = "sha256:" + "a".repeat(64);

describe("parseRef", () => {
  it("parses a hash-id loadout reference", () => {
    const ref = parseRef(`${LOADOUT_RESOURCE_TYPE}:${HASH}`);
    expect(ref).toEqual({ type: LOADOUT_RESOURCE_TYPE, id: HASH });
  });

  it("parses an alias-id loadout reference", () => {
    const ref = parseRef(`${LOADOUT_RESOURCE_TYPE}:code-reviewer@2.0.0`);
    expect(ref).toEqual({ type: LOADOUT_RESOURCE_TYPE, id: "code-reviewer@2.0.0" });
  });

  it("parses a hash-id team reference", () => {
    const ref = parseRef(`${TEAM_RESOURCE_TYPE}:${HASH}`);
    expect(ref).toEqual({ type: TEAM_RESOURCE_TYPE, id: HASH });
  });

  it("parses an alias-id team reference", () => {
    const ref = parseRef(`${TEAM_RESOURCE_TYPE}:gsd@1.4.0`);
    expect(ref).toEqual({ type: TEAM_RESOURCE_TYPE, id: "gsd@1.4.0" });
  });

  it("returns null for unknown resource types", () => {
    expect(parseRef("x-other/loadout:sha256:abc")).toBeNull();
    expect(parseRef("x-openteams/spawn:sha256:abc")).toBeNull();
    expect(parseRef("x-openteams/loadouts:sha256:abc")).toBeNull();
  });

  it("returns null when the id is empty", () => {
    expect(parseRef(`${LOADOUT_RESOURCE_TYPE}:`)).toBeNull();
  });

  it("returns null when there is no colon", () => {
    expect(parseRef("x-openteams/loadout")).toBeNull();
    expect(parseRef("just-a-name")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(parseRef("")).toBeNull();
  });

  it("preserves a multi-colon id verbatim (the first colon ends the type)", () => {
    // sha256 ids contain a colon themselves
    const ref = parseRef(`${LOADOUT_RESOURCE_TYPE}:sha256:abcdef`);
    expect(ref).toEqual({ type: LOADOUT_RESOURCE_TYPE, id: "sha256:abcdef" });
  });
});

describe("formatRef", () => {
  it("formats a parsed ref back to its string form", () => {
    const ref = { type: LOADOUT_RESOURCE_TYPE, id: HASH } as const;
    expect(formatRef(ref)).toBe(`${LOADOUT_RESOURCE_TYPE}:${HASH}`);
  });

  it("round-trips with parseRef", () => {
    const cases = [
      `${LOADOUT_RESOURCE_TYPE}:${HASH}`,
      `${LOADOUT_RESOURCE_TYPE}:code-reviewer@2.0.0`,
      `${TEAM_RESOURCE_TYPE}:${HASH}`,
      `${TEAM_RESOURCE_TYPE}:gsd@1.4.0`,
    ];
    for (const s of cases) {
      const parsed = parseRef(s);
      expect(parsed).not.toBeNull();
      expect(formatRef(parsed!)).toBe(s);
    }
  });
});

describe("isHashId", () => {
  it("matches sha256:<64-hex>", () => {
    expect(isHashId(HASH)).toBe(true);
    expect(isHashId("sha256:" + "0".repeat(64))).toBe(true);
  });

  it("rejects shorter or longer hex", () => {
    expect(isHashId("sha256:abc")).toBe(false);
    expect(isHashId("sha256:" + "a".repeat(63))).toBe(false);
    expect(isHashId("sha256:" + "a".repeat(65))).toBe(false);
  });

  it("rejects non-hex characters", () => {
    expect(isHashId("sha256:" + "g".repeat(64))).toBe(false);
  });

  it("rejects aliases", () => {
    expect(isHashId("code-reviewer@2.0.0")).toBe(false);
  });
});

describe("isAliasId", () => {
  it("matches <name>@<version>", () => {
    expect(isAliasId("code-reviewer@2.0.0")).toBe(true);
    expect(isAliasId("gsd@latest")).toBe(true);
    expect(isAliasId("scoped/name@1.0.0-rc.1")).toBe(true);
  });

  it("rejects strings without @", () => {
    expect(isAliasId("code-reviewer")).toBe(false);
  });

  it("rejects hash ids", () => {
    expect(isAliasId(HASH)).toBe(false);
  });
});

describe("splitAliasId", () => {
  it("splits a simple alias", () => {
    expect(splitAliasId("code-reviewer@2.0.0")).toEqual({
      name: "code-reviewer",
      version: "2.0.0",
    });
  });

  it("splits at the last @ (so versions can contain @ if exotic)", () => {
    expect(splitAliasId("name@1.0.0+build@meta")).toEqual({
      name: "name@1.0.0+build",
      version: "meta",
    });
  });

  it("returns null for non-aliases", () => {
    expect(splitAliasId(HASH)).toBeNull();
    expect(splitAliasId("just-a-name")).toBeNull();
  });
});

describe("loadoutRef / teamRef", () => {
  it("builds a loadout reference", () => {
    expect(loadoutRef(HASH)).toBe(`${LOADOUT_RESOURCE_TYPE}:${HASH}`);
  });

  it("builds a team reference", () => {
    expect(teamRef(HASH)).toBe(`${TEAM_RESOURCE_TYPE}:${HASH}`);
  });

  it("round-trips through parseRef", () => {
    expect(parseRef(loadoutRef(HASH))?.id).toBe(HASH);
    expect(parseRef(teamRef(HASH))?.type).toBe(TEAM_RESOURCE_TYPE);
  });
});

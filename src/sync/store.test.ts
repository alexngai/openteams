import { describe, it, expect, beforeEach } from "vitest";

import { InMemoryBundleStore } from "./store";
import { LOADOUT_RESOURCE_TYPE, TEAM_RESOURCE_TYPE, type MAPResource } from "./types";

function makeResource(type: string, id: string): MAPResource {
  return {
    id,
    type,
    name: `name-${id}`,
    status: "active",
    owner_id: "",
    origin_hub_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    metadata: {},
  };
}

describe("InMemoryBundleStore", () => {
  let store: InMemoryBundleStore;

  beforeEach(() => {
    store = new InMemoryBundleStore();
  });

  it("returns null on get when the resource is absent", async () => {
    expect(await store.get(LOADOUT_RESOURCE_TYPE, "missing")).toBeNull();
  });

  it("stores and retrieves a resource", async () => {
    const r = makeResource(LOADOUT_RESOURCE_TYPE, "sha256:abc");
    await store.put(r);
    expect(await store.get(LOADOUT_RESOURCE_TYPE, "sha256:abc")).toEqual(r);
  });

  it("scopes ids by type", async () => {
    const a = makeResource(LOADOUT_RESOURCE_TYPE, "sha256:1");
    const b = makeResource(TEAM_RESOURCE_TYPE, "sha256:1");
    await store.put(a);
    await store.put(b);

    expect(await store.get(LOADOUT_RESOURCE_TYPE, "sha256:1")).toEqual(a);
    expect(await store.get(TEAM_RESOURCE_TYPE, "sha256:1")).toEqual(b);
  });

  it("overwrites on put for the same (type, id)", async () => {
    const a = makeResource(LOADOUT_RESOURCE_TYPE, "sha256:abc");
    const b = { ...a, name: "renamed" };
    await store.put(a);
    await store.put(b);
    const got = await store.get(LOADOUT_RESOURCE_TYPE, "sha256:abc");
    expect(got?.name).toBe("renamed");
  });

  it("lists all resources of a type", async () => {
    for (let i = 0; i < 3; i++) {
      await store.put(makeResource(LOADOUT_RESOURCE_TYPE, `sha256:${i}`));
    }
    const result = await store.list(LOADOUT_RESOURCE_TYPE);
    expect(result.resources.length).toBe(3);
    expect(result.total).toBe(3);
    expect(result.cursor).toBeNull();
  });

  it("paginates list results via cursor + limit", async () => {
    for (let i = 0; i < 5; i++) {
      await store.put(makeResource(LOADOUT_RESOURCE_TYPE, `sha256:${i}`));
    }
    const page1 = await store.list(LOADOUT_RESOURCE_TYPE, { limit: 2 });
    expect(page1.resources.length).toBe(2);
    expect(page1.cursor).toBe("2");

    const page2 = await store.list(LOADOUT_RESOURCE_TYPE, {
      limit: 2,
      cursor: page1.cursor,
    });
    expect(page2.resources.length).toBe(2);
    expect(page2.cursor).toBe("4");

    const page3 = await store.list(LOADOUT_RESOURCE_TYPE, {
      limit: 2,
      cursor: page2.cursor,
    });
    expect(page3.resources.length).toBe(1);
    expect(page3.cursor).toBeNull();
  });

  it("delete returns true when removing an existing resource and false otherwise", async () => {
    const r = makeResource(LOADOUT_RESOURCE_TYPE, "sha256:abc");
    await store.put(r);
    expect(await store.delete(LOADOUT_RESOURCE_TYPE, "sha256:abc")).toBe(true);
    expect(await store.delete(LOADOUT_RESOURCE_TYPE, "sha256:abc")).toBe(false);
    expect(await store.get(LOADOUT_RESOURCE_TYPE, "sha256:abc")).toBeNull();
  });

  it("count and clear work as expected", async () => {
    expect(store.count()).toBe(0);
    await store.put(makeResource(LOADOUT_RESOURCE_TYPE, "sha256:1"));
    await store.put(makeResource(TEAM_RESOURCE_TYPE, "sha256:1"));
    expect(store.count()).toBe(2);
    expect(store.count(LOADOUT_RESOURCE_TYPE)).toBe(1);

    store.clear();
    expect(store.count()).toBe(0);
  });
});

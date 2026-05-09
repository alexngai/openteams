// ─────────────────────────────────────────────────────────────
// In-memory bundle store
// ─────────────────────────────────────────────────────────────
// Reference implementation of `BundleStore`. Useful for tests and
// for hubs that don't need durability (e.g. ephemeral coordination
// scenarios). Production hubs should implement their own backend.

import type {
  BundleStore,
  ListResourcesParams,
  ListResourcesResult,
  MAPResource,
} from "./types";

/**
 * In-memory store of MAP resources, keyed by `(type, id)`. Pagination
 * uses a simple offset cursor — `cursor` is the index of the next
 * page's first item as a base-10 string. `limit` defaults to 50.
 */
export class InMemoryBundleStore implements BundleStore {
  private byType = new Map<string, Map<string, MAPResource>>();

  async get(type: string, id: string): Promise<MAPResource | null> {
    return this.byType.get(type)?.get(id) ?? null;
  }

  async list(
    type: string,
    opts: ListResourcesParams = {}
  ): Promise<ListResourcesResult> {
    const all = Array.from(this.byType.get(type)?.values() ?? []);
    const total = all.length;
    const start = opts.cursor != null ? Number.parseInt(opts.cursor, 10) || 0 : 0;
    const limit = opts.limit ?? 50;
    const page = all.slice(start, start + limit);
    const next = start + page.length < total ? String(start + page.length) : null;
    return { resources: page, cursor: next, total };
  }

  async put(resource: MAPResource): Promise<MAPResource> {
    let bucket = this.byType.get(resource.type);
    if (!bucket) {
      bucket = new Map();
      this.byType.set(resource.type, bucket);
    }
    bucket.set(resource.id, resource);
    return resource;
  }

  async delete(type: string, id: string): Promise<boolean> {
    return this.byType.get(type)?.delete(id) ?? false;
  }

  /** Synchronous size accessor for tests and observability. */
  count(type?: string): number {
    if (type) return this.byType.get(type)?.size ?? 0;
    let total = 0;
    for (const bucket of this.byType.values()) total += bucket.size;
    return total;
  }

  /** Discard all contents — handy in beforeEach. */
  clear(): void {
    this.byType.clear();
  }
}

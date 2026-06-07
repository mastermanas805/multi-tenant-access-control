/**
 * A tiny bounded TTL + LRU cache for the PIP (DESIGN §9.1, App. D.3): the PIP
 * caches the active WORKING SET of principals (LRU eviction), each entry expires
 * at a hard TTL ceiling (the GUARANTEED staleness bound even if a change event is
 * missed — DESIGN §9.1). No dependencies; in-process L1 (DESIGN §8.7).
 *
 * Eviction policy: Map preserves insertion order, so the first key is the LRU; a
 * read promotes the entry (delete + re-set) to MRU.
 */
export class TtlLruCache<V> {
  private readonly store = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns the value if present AND not expired; otherwise undefined (and evicts a stale entry). */
  public get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (entry === undefined) {
      return undefined;
    }
    if (entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    // Promote to MRU.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  /** Inserts/updates a value with a fresh TTL, evicting the LRU entry if over capacity. */
  public set(key: string, value: V): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      const lruKey = this.store.keys().next().value;
      if (lruKey !== undefined) {
        this.store.delete(lruKey);
      }
    }
    this.store.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  /** Explicit invalidation (e.g. on a PAP change event — DESIGN §3.4). */
  public delete(key: string): void {
    this.store.delete(key);
  }

  public clear(): void {
    this.store.clear();
  }

  public get size(): number {
    return this.store.size;
  }
}

/**
 * Cursor pagination primitives (DESIGN §8.1: lists use `?limit=&cursor=`).
 * The cursor is an opaque, base64-encoded string the client echoes back; the
 * repository decides what it encodes (e.g. the last row's sort key).
 */

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

/** A normalized page request. Construct via `PageQuery.from(...)` to clamp limits. */
export class PageQuery {
  public readonly limit: number;
  public readonly cursor: string | null;

  private constructor(limit: number, cursor: string | null) {
    this.limit = limit;
    this.cursor = cursor;
  }

  /** Clamps limit into [1, MAX_PAGE_LIMIT] and normalizes an empty cursor to null. */
  public static from(input?: { limit?: number; cursor?: string | null }): PageQuery {
    const requested = input?.limit ?? DEFAULT_PAGE_LIMIT;
    const limit = Math.min(Math.max(1, Math.trunc(requested)), MAX_PAGE_LIMIT);
    const rawCursor = input?.cursor ?? null;
    const cursor = rawCursor && rawCursor.length > 0 ? rawCursor : null;
    return new PageQuery(limit, cursor);
  }
}

/** A page of results plus the cursor to fetch the next page (null when exhausted). */
export interface CursorPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

/** Helper to build a CursorPage consistently across repositories. */
export function makeCursorPage<T>(items: readonly T[], nextCursor: string | null): CursorPage<T> {
  return {
    items,
    nextCursor,
    hasMore: nextCursor !== null,
  };
}

/** Encode/decode opaque cursors so repositories don't reinvent the wheel. */
export const Cursor = {
  encode(value: string): string {
    return Buffer.from(value, 'utf8').toString('base64url');
  },
  decode(cursor: string): string {
    return Buffer.from(cursor, 'base64url').toString('utf8');
  },
} as const;

/**
 * Server-side state for an issued refresh token. The opaque token string handed
 * to the client is the lookup key; we persist only the binding + expiry so a
 * refresh can be validated and a session revoked server-side (DESIGN §5 — a
 * refresh, unlike a stateless access token, is a stateful, revocable handle).
 */
export interface RefreshTokenRecord {
  /** The opaque refresh-token value (the client's secret; the lookup key). */
  token: string;
  /** The user this refresh token authenticates. */
  userId: string;
  /** The tenant context bound at login. */
  tenantId: string;
  /** The session id this refresh token belongs to. */
  sessionId: string;
  /** Unix-seconds absolute expiry. */
  expiresAt: number;
}

/**
 * Port for refresh-token persistence + rotation. The domain/application layers
 * depend only on this interface; the in-memory adapter implements it (a real
 * deployment would back it with Redis/Postgres). Rotation = consume-on-use:
 * `consume` atomically deletes the presented token so a stolen-and-replayed
 * token is rejected after first use (refresh-token rotation, DESIGN §7).
 */
export interface RefreshTokenStore {
  /** Persists a freshly issued refresh-token record. */
  save(record: RefreshTokenRecord): Promise<void>;

  /**
   * Atomically looks up AND removes a refresh token (single-use rotation).
   * Returns the record if present and not yet consumed, else null. Callers must
   * still check expiry. Returning null for an unknown token is fail-closed.
   */
  consume(token: string): Promise<RefreshTokenRecord | null>;
}

/** DI token for the refresh-token store port. */
export const REFRESH_TOKEN_STORE = Symbol('REFRESH_TOKEN_STORE');

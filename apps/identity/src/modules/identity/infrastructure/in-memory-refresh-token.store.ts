import { Injectable } from '@nestjs/common';

import {
  type RefreshTokenRecord,
  type RefreshTokenStore,
} from '../domain/refresh-token-store.port';

/**
 * In-memory refresh-token store with consume-on-use rotation. Suitable for the
 * reference IdP / single-instance demo; a multi-instance deployment would back
 * this port with Redis or Postgres (same interface, no use-case changes).
 *
 * `consume` is atomic in this single-threaded model: it reads-then-deletes in
 * one synchronous step, so a replayed token finds nothing the second time.
 */
@Injectable()
export class InMemoryRefreshTokenStore implements RefreshTokenStore {
  private readonly byToken = new Map<string, RefreshTokenRecord>();

  public save(record: RefreshTokenRecord): Promise<void> {
    this.byToken.set(record.token, record);
    return Promise.resolve();
  }

  public consume(token: string): Promise<RefreshTokenRecord | null> {
    const record = this.byToken.get(token) ?? null;
    if (record !== null) {
      this.byToken.delete(token);
    }
    return Promise.resolve(record);
  }
}

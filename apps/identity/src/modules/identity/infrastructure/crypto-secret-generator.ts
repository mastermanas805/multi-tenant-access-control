import { randomBytes, randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { type SecretGenerator } from '../domain/secret-generator.port';

/** Bytes of entropy per opaque refresh token (256 bits). */
const REFRESH_TOKEN_BYTES = 32;

/**
 * CSPRNG-backed secret generator (Node's crypto). Refresh tokens are 256-bit
 * URL-safe randoms; session ids are UUIDv4. No external deps.
 */
@Injectable()
export class CryptoSecretGenerator implements SecretGenerator {
  public refreshToken(): string {
    return `rt_${randomBytes(REFRESH_TOKEN_BYTES).toString('base64url')}`;
  }

  public sessionId(): string {
    return `sid_${randomUUID()}`;
  }
}

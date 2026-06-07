import { createPublicKey, createVerify, type JsonWebKey, type KeyObject } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { type Clock, CLOCK, UnauthenticatedError } from '@kernel/core';

import { ConfigService } from '../../../config/config.service';
import { type AccessTokenClaims } from '../domain/access-token-claims';
import { type TokenVerifier } from '../domain/token-verifier.port';
import { type BearerToken } from '../domain/value-objects/bearer-token.vo';

/** One JWK as published by the Identity service's JWKS endpoint. */
interface RemoteJwk {
  kty?: string;
  use?: string;
  alg?: string;
  kid?: string;
  n?: string;
  e?: string;
}

/**
 * Verifies an end-user RS256 access token against the Identity service's public
 * JWKS (DESIGN §4.3 step 1, §5, §7). Like the Identity signer, it uses Node's
 * `crypto` directly — no external JWT library — so the verification path is fully
 * auditable: split the compact JWS, look up the signing key by `kid`, verify the
 * RSASSA-PKCS1-v1_5 + SHA-256 signature over `header.payload`, then check the
 * registered claims (alg, exp, nbf, iat, iss, aud) with a configured clock skew.
 *
 * Public keys are cached for JWKS_CACHE_TTL_SECONDS (keys rotate slowly) and
 * re-fetched on a cache miss/expiry. Fail-closed (D8): every failure path throws
 * a GENERIC UnauthenticatedError so a probe cannot tell why a token was rejected.
 */
@Injectable()
export class JwksTokenVerifier implements TokenVerifier {
  private cache: { keys: Map<string, KeyObject>; fetchedAtMs: number } | null = null;
  private inflight: Promise<Map<string, KeyObject>> | null = null;

  constructor(
    private readonly config: ConfigService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public async verify(token: BearerToken): Promise<AccessTokenClaims> {
    const raw = token.toString();
    const [headerB64, payloadB64, signatureB64] = raw.split('.') as [string, string, string];

    const header = this.decodeJson(headerB64, 'header');
    if (header.alg !== 'RS256') {
      // Reject `alg:none` and HS/EC confusion attacks — only RS256 is accepted.
      throw new UnauthenticatedError('Authentication required', 'unsupported_alg');
    }
    const kid = header.kid;
    if (typeof kid !== 'string' || kid.length === 0) {
      throw new UnauthenticatedError('Authentication required', 'missing_kid');
    }

    const key = await this.resolveKey(kid);
    const signatureOk = createVerify('RSA-SHA256')
      .update(`${headerB64}.${payloadB64}`)
      .verify(key, Buffer.from(signatureB64, 'base64url'));
    if (!signatureOk) {
      throw new UnauthenticatedError('Authentication required', 'invalid_signature');
    }

    const claims = this.decodeJson(payloadB64, 'payload');
    return this.validateClaims(claims);
  }

  // --- Claim validation ------------------------------------------------------

  private validateClaims(claims: Record<string, unknown>): AccessTokenClaims {
    const nowSeconds = Math.floor(this.clock.now().getTime() / 1000);
    const skew = this.config.values.JWT_CLOCK_TOLERANCE_SECONDS;

    const exp = claims.exp;
    if (typeof exp !== 'number' || nowSeconds > exp + skew) {
      throw new UnauthenticatedError('Authentication required', 'token_expired');
    }
    const nbf = claims.nbf;
    if (typeof nbf === 'number' && nowSeconds + skew < nbf) {
      throw new UnauthenticatedError('Authentication required', 'token_not_yet_valid');
    }

    const expectedIssuer = this.config.values.IDENTITY_ISSUER;
    if (expectedIssuer.length > 0 && claims.iss !== expectedIssuer) {
      throw new UnauthenticatedError('Authentication required', 'issuer_mismatch');
    }
    const expectedAudience = this.config.values.IDENTITY_AUDIENCE;
    if (expectedAudience.length > 0 && !this.audienceMatches(claims.aud, expectedAudience)) {
      throw new UnauthenticatedError('Authentication required', 'audience_mismatch');
    }

    const sub = claims.sub;
    const tid = claims.tid;
    const sid = claims.sid;
    if (typeof sub !== 'string' || typeof tid !== 'string' || typeof sid !== 'string') {
      throw new UnauthenticatedError('Authentication required', 'missing_required_claim');
    }

    return {
      sub,
      tid,
      sid,
      ...(typeof claims.act === 'string' ? { act: claims.act } : {}),
      // The platform-admin scope, when present, MUST be a real boolean `true` — any
      // other shape (string "true", 1, etc.) is NOT honored (fail-closed: absence
      // and a non-boolean both resolve to a non-admin principal downstream).
      ...(claims.platform_admin === true ? { platformAdmin: true } : {}),
      ...(typeof claims.iss === 'string' ? { iss: claims.iss } : {}),
      ...(typeof claims.aud === 'string' ? { aud: claims.aud } : {}),
      exp,
      ...(typeof claims.iat === 'number' ? { iat: claims.iat } : {}),
      ...(typeof nbf === 'number' ? { nbf } : {}),
    };
  }

  /** `aud` may be a string or an array of strings (RFC 7519). */
  private audienceMatches(aud: unknown, expected: string): boolean {
    if (typeof aud === 'string') {
      return aud === expected;
    }
    if (Array.isArray(aud)) {
      return aud.includes(expected);
    }
    return false;
  }

  // --- JWKS fetch + cache ----------------------------------------------------

  private async resolveKey(kid: string): Promise<KeyObject> {
    let keys = this.cachedKeys();
    let key = keys?.get(kid);
    if (key !== undefined) {
      return key;
    }
    // Cache miss or expired (possibly a freshly-rotated kid): re-fetch once.
    keys = await this.fetchKeys();
    key = keys.get(kid);
    if (key === undefined) {
      throw new UnauthenticatedError('Authentication required', 'unknown_key');
    }
    return key;
  }

  private cachedKeys(): Map<string, KeyObject> | null {
    if (this.cache === null) {
      return null;
    }
    const ageMs = this.clock.now().getTime() - this.cache.fetchedAtMs;
    if (ageMs > this.config.values.JWKS_CACHE_TTL_SECONDS * 1000) {
      return null;
    }
    return this.cache.keys;
  }

  private async fetchKeys(): Promise<Map<string, KeyObject>> {
    // Coalesce concurrent fetches so a burst of cold requests makes ONE call.
    if (this.inflight !== null) {
      return this.inflight;
    }
    this.inflight = this.doFetchKeys();
    try {
      return await this.inflight;
    } finally {
      this.inflight = null;
    }
  }

  private async doFetchKeys(): Promise<Map<string, KeyObject>> {
    const url = this.config.values.IDENTITY_JWKS_URL;
    let body: { keys?: RemoteJwk[] };
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(this.config.values.UPSTREAM_TIMEOUT_MS),
        headers: { accept: 'application/json' },
      });
      if (!res.ok) {
        throw new Error(`JWKS endpoint returned ${String(res.status)}`);
      }
      body = (await res.json()) as { keys?: RemoteJwk[] };
    } catch {
      // A JWKS we cannot fetch means we cannot verify ANY token — fail closed.
      throw new UnauthenticatedError('Authentication required', 'jwks_unavailable');
    }

    const keys = new Map<string, KeyObject>();
    for (const jwk of body.keys ?? []) {
      if (jwk.kty !== 'RSA' || typeof jwk.kid !== 'string' || !jwk.n || !jwk.e) {
        continue;
      }
      try {
        keys.set(jwk.kid, createPublicKey({ key: jwk as unknown as JsonWebKey, format: 'jwk' }));
      } catch {
        // Skip a malformed key rather than failing the whole set.
      }
    }
    if (keys.size === 0) {
      throw new UnauthenticatedError('Authentication required', 'jwks_empty');
    }

    this.cache = { keys, fetchedAtMs: this.clock.now().getTime() };
    return keys;
  }

  private decodeJson(segmentB64: string, what: string): Record<string, unknown> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(segmentB64, 'base64url').toString('utf8'));
    } catch {
      throw new UnauthenticatedError('Authentication required', `malformed_${what}`);
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new UnauthenticatedError('Authentication required', `malformed_${what}`);
    }
    return parsed as Record<string, unknown>;
  }
}

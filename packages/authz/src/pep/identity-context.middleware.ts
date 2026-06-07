import { createHmac, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import { type NextFunction, type Request, type Response } from 'express';

import { UnauthenticatedError } from '@kernel/core';
import { type InternalIdentityToken } from '@contracts/core';

import { AUTHZ_OPTIONS, type AuthzModuleOptions } from '../module/authz.options';
import { principalContextFromToken } from './authz-request-context';
import './express-augmentation';

const DEFAULT_INTERNAL_TOKEN_ISSUER = 'api-gateway';
const DEFAULT_CLOCK_TOLERANCE_SECONDS = 60;

/**
 * Reads the INTERNAL identity token the gateway mints (token-exchange, RFC 8693)
 * and populates `req.authzPrincipal` for the PEP guard (DESIGN §4.3 step 1-2, §5,
 * §7). The gateway forwards two headers:
 *
 *   - `x-internal-identity`            base64url(JSON(InternalIdentityToken)) — the claims.
 *   - `x-internal-identity-signature`  the HS256 compact JWS over the same claims.
 *
 * PRODUCTION PATH (signature verification ENABLED — `internalTokenSecret` set):
 * the middleware VERIFIES `x-internal-identity-signature` as an HS256 JWS against
 * the shared secret the gateway signs with, checks `iss` (= `api-gateway`) and
 * `exp`, and confirms the signed payload's identity claims match the
 * `x-internal-identity` header. ANY failure — missing signature, wrong alg, bad
 * MAC, wrong issuer, expired, or a claim mismatch — is rejected with 401. A
 * plaintext identity header is NEVER trusted on its own (confused-deputy defense,
 * DESIGN §7). This is the path a real deployment runs.
 *
 * DEV/TEST PATH (signature verification DISABLED — `internalTokenSecret`
 * unset/empty): the middleware runs the documented placeholder that only
 * base64url-decodes `x-internal-identity`. The unit/e2e/integration suites set the
 * principal context directly (they inject the claims without standing up the real
 * gateway hop), so they exercise the PEP -> Cerbos -> PIP -> RLS chain without a
 * signature. Production deployments MUST configure the secret to leave this mode.
 */
@Injectable()
export class IdentityContextMiddleware implements NestMiddleware {
  public static readonly TOKEN_HEADER = 'x-internal-identity';
  public static readonly SIGNATURE_HEADER = 'x-internal-identity-signature';

  private readonly secret: string;
  private readonly expectedIssuer: string;
  private readonly clockToleranceSeconds: number;

  constructor(@Inject(AUTHZ_OPTIONS) options: AuthzModuleOptions) {
    this.secret = options.internalTokenSecret ?? '';
    this.expectedIssuer = options.internalTokenIssuer ?? DEFAULT_INTERNAL_TOKEN_ISSUER;
    this.clockToleranceSeconds =
      options.internalTokenClockToleranceSeconds ?? DEFAULT_CLOCK_TOLERANCE_SECONDS;
  }

  /** True when a shared secret is configured — the production signature-verifying path. */
  private get verifySignature(): boolean {
    return this.secret.length > 0;
  }

  public use(req: Request, _res: Response, next: NextFunction): void {
    const token = this.verifySignature ? this.verifySignedToken(req) : this.decodePlaceholder(req);
    req.authzPrincipal = principalContextFromToken(token);
    next();
  }

  /**
   * PRODUCTION: verify the HS256 JWS in `x-internal-identity-signature` against the
   * shared secret, enforce iss + exp, and bind it to the `x-internal-identity`
   * claims. Throws UnauthenticatedError (-> 401) on any failure. The message is
   * generic so a probe cannot tell WHY a token was rejected; `reason` is for logs.
   */
  private verifySignedToken(req: Request): InternalIdentityToken {
    const compactJws = this.singleHeader(req, IdentityContextMiddleware.SIGNATURE_HEADER);
    if (compactJws === undefined) {
      throw new UnauthenticatedError('Authentication required', 'missing_internal_signature');
    }

    const segments = compactJws.split('.');
    if (segments.length !== 3) {
      throw new UnauthenticatedError('Authentication required', 'malformed_internal_signature');
    }
    const [headerB64, payloadB64, signatureB64] = segments as [string, string, string];

    const header = this.decodeJsonSegment(headerB64, 'header');
    if (header.alg !== 'HS256') {
      // Reject `none` and any asymmetric alg outright — never honor an attacker's
      // alg downgrade (the classic JWS alg-confusion attack).
      throw new UnauthenticatedError('Authentication required', 'unsupported_internal_alg');
    }

    // Constant-time MAC check over the EXACT signing input (header.payload).
    const signingInput = `${headerB64}.${payloadB64}`;
    const expected = createHmac('sha256', this.secret).update(signingInput).digest();
    let provided: Buffer;
    try {
      provided = Buffer.from(signatureB64, 'base64url');
    } catch {
      throw new UnauthenticatedError('Authentication required', 'malformed_internal_signature');
    }
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw new UnauthenticatedError('Authentication required', 'invalid_internal_signature');
    }

    const payload = this.decodeJsonSegment(payloadB64, 'payload');

    // iss MUST be the gateway (DESIGN §5, §7) — a token from any other issuer is
    // not a gateway-minted internal token, even if it MACs under a shared secret.
    if (payload.iss !== this.expectedIssuer) {
      throw new UnauthenticatedError('Authentication required', 'internal_issuer_mismatch');
    }

    // exp MUST be present and in the future (with clock-skew tolerance).
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
      throw new UnauthenticatedError('Authentication required', 'internal_exp_missing');
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (payload.exp + this.clockToleranceSeconds < nowSeconds) {
      throw new UnauthenticatedError('Authentication required', 'internal_token_expired');
    }

    if (!this.isValidToken(payload)) {
      throw new UnauthenticatedError('Authentication required', 'internal_claims_missing');
    }

    // Bind the plaintext `x-internal-identity` header (what the PEP/RLS read) to
    // the SIGNED payload so a caller cannot pair a valid signature with different
    // claims. If the header is present it MUST match the signed claims; either way
    // the principal is derived from the verified payload, never the raw header.
    this.assertHeaderMatchesSignedClaims(req, payload);

    return payload;
  }

  /**
   * DEV/TEST placeholder: decode the base64url JSON `x-internal-identity` header
   * with NO signature check. Only reachable when no shared secret is configured.
   */
  private decodePlaceholder(req: Request): InternalIdentityToken {
    const raw = this.singleHeader(req, IdentityContextMiddleware.TOKEN_HEADER);
    if (raw === undefined) {
      throw new UnauthenticatedError(
        `Missing ${IdentityContextMiddleware.TOKEN_HEADER} header (dev/test placeholder for the signed internal token)`,
        'missing_internal_identity',
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    } catch {
      throw new UnauthenticatedError('Malformed internal identity token', 'malformed_internal_identity');
    }
    if (!this.isValidToken(parsed)) {
      throw new UnauthenticatedError(
        'Internal identity token missing required claims',
        'internal_claims_missing',
      );
    }
    return parsed;
  }

  /** When the raw identity header is present, it must equal the signed claims. */
  private assertHeaderMatchesSignedClaims(req: Request, signed: InternalIdentityToken): void {
    const raw = this.singleHeader(req, IdentityContextMiddleware.TOKEN_HEADER);
    if (raw === undefined) {
      return;
    }
    let headerToken: unknown;
    try {
      headerToken = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    } catch {
      throw new UnauthenticatedError('Authentication required', 'malformed_internal_identity');
    }
    if (!this.isValidToken(headerToken)) {
      throw new UnauthenticatedError('Authentication required', 'internal_claims_missing');
    }
    // Bind the privilege claim too: the (untrusted) header must not assert a
    // platform-admin scope the SIGNED payload does not carry. Normalize both to a
    // boolean so an omitted claim equals an explicit `false` (fail-closed — the
    // principal is still derived from the signed payload either way).
    const headerIsAdmin = headerToken.platformAdmin === true;
    const signedIsAdmin = signed.platformAdmin === true;
    const matches =
      headerToken.sub === signed.sub &&
      headerToken.tid === signed.tid &&
      headerToken.actorId === signed.actorId &&
      headerToken.sessionId === signed.sessionId &&
      headerIsAdmin === signedIsAdmin;
    if (!matches) {
      throw new UnauthenticatedError('Authentication required', 'internal_identity_mismatch');
    }
  }

  /** Returns the single, non-empty header value, or undefined if absent/blank. */
  private singleHeader(req: Request, name: string): string | undefined {
    const header = req.headers[name];
    const raw = Array.isArray(header) ? header[0] : header;
    if (raw === undefined || raw.trim().length === 0) {
      return undefined;
    }
    return raw;
  }

  /** Decodes one base64url JSON JWS segment into a plain object, or rejects (401). */
  private decodeJsonSegment(segment: string, what: 'header' | 'payload'): Record<string, unknown> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    } catch {
      throw new UnauthenticatedError('Authentication required', `malformed_internal_${what}`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new UnauthenticatedError('Authentication required', `malformed_internal_${what}`);
    }
    return parsed as Record<string, unknown>;
  }

  private isValidToken(value: unknown): value is InternalIdentityToken {
    if (typeof value !== 'object' || value === null) {
      return false;
    }
    const t = value as Record<string, unknown>;
    return (
      typeof t.sub === 'string' &&
      typeof t.tid === 'string' &&
      typeof t.actorId === 'string' &&
      typeof t.sessionId === 'string'
    );
  }
}

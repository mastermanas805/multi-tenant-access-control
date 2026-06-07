import { type GatewayIdentity } from '../../auth/domain/gateway-identity';

/**
 * Header names the gateway DERIVES from the verified identity and forwards to the
 * downstream PEPs. These mirror exactly what the services consume:
 *   - x-internal-identity            -> @authz/pep IdentityContextMiddleware (the
 *                                       signed internal token, base64url JSON).
 *   - x-internal-identity-signature  -> the HS256 JWS over the same claims (the
 *                                       token-exchange artifact, §7).
 *   - x-tenant-id                    -> authz-admin TenantContextGuard.TENANT_HEADER.
 *   - x-actor-id                     -> authz-admin TenantContextGuard.ACTOR_HEADER.
 */
export const INTERNAL_IDENTITY_HEADER = 'x-internal-identity';
export const INTERNAL_IDENTITY_SIGNATURE_HEADER = 'x-internal-identity-signature';
export const TENANT_CONTEXT_HEADER = 'x-tenant-id';
export const ACTOR_CONTEXT_HEADER = 'x-actor-id';
export const PLATFORM_ADMIN_HEADER = 'x-platform-admin';

/**
 * Headers the gateway STRIPS from the inbound client request before forwarding —
 * the confused-deputy defense (DESIGN §7): a client must never be able to assert
 * its own identity/tenant/actor/admin context. Every one of these is re-derived
 * server-side from the verified JWT and overwritten. `x-platform-admin` is
 * stripped unconditionally: privilege elevation is a verified-claim decision, not
 * a client-settable header (fail-closed).
 */
export const CLIENT_SPOOFABLE_HEADERS: readonly string[] = [
  INTERNAL_IDENTITY_HEADER,
  INTERNAL_IDENTITY_SIGNATURE_HEADER,
  TENANT_CONTEXT_HEADER,
  ACTOR_CONTEXT_HEADER,
  PLATFORM_ADMIN_HEADER,
];

/**
 * Hop-by-hop headers that must not be forwarded by a proxy (RFC 7230 §6.1) plus
 * `host` (set per-upstream) and `content-length` (recomputed by the HTTP client).
 */
export const HOP_BY_HOP_HEADERS: readonly string[] = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
];

/**
 * The trusted identity context headers the gateway INJECTS for an authenticated
 * forward. Derived ONLY from the verified GatewayIdentity + the minted internal
 * token — never from client input.
 */
export interface InjectedIdentityHeaders {
  readonly internalIdentity: string;
  readonly internalIdentitySignature: string;
}

/**
 * Pure, framework-free header policy for a proxied request. Produces the final
 * forwarded header set:
 *   1. drop hop-by-hop headers,
 *   2. drop every client-spoofable identity/context header (§7),
 *   3. for an authenticated route, inject the server-derived identity headers.
 *
 * Header keys are lower-cased throughout (HTTP header names are case-insensitive),
 * which also guarantees a client cannot smuggle e.g. `X-Tenant-Id` past the strip.
 */
export function buildForwardedHeaders(
  clientHeaders: Record<string, string | string[] | undefined>,
  identity: GatewayIdentity | null,
  injected: InjectedIdentityHeaders | null,
): Record<string, string> {
  const dropped = new Set<string>([
    ...HOP_BY_HOP_HEADERS,
    ...CLIENT_SPOOFABLE_HEADERS,
  ]);

  const out: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(clientHeaders)) {
    const key = rawKey.toLowerCase();
    if (dropped.has(key) || rawValue === undefined) {
      continue;
    }
    out[key] = Array.isArray(rawValue) ? rawValue.join(', ') : rawValue;
  }

  // Inject the trusted, server-derived identity for authenticated forwards only.
  if (identity !== null && injected !== null) {
    out[INTERNAL_IDENTITY_HEADER] = injected.internalIdentity;
    out[INTERNAL_IDENTITY_SIGNATURE_HEADER] = injected.internalIdentitySignature;
    out[TENANT_CONTEXT_HEADER] = identity.tid;
    out[ACTOR_CONTEXT_HEADER] = identity.actorId;
    // Re-derive x-platform-admin from the VERIFIED identity (the client-sent value
    // was stripped above). Set only when the principal is actually an admin, so the
    // header's mere presence is never accidental. NOTE: this is a derived
    // convenience/observability header — downstream PEPs (the PAP) authorize the
    // platform-admin scope from the SIGNED internal token, not from this header (§7).
    if (identity.platformAdmin) {
      out[PLATFORM_ADMIN_HEADER] = 'true';
    }
  }

  return out;
}

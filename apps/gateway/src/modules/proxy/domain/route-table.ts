import { type RouteTarget } from './upstream';

/**
 * The authz-admin (PAP) IAM resource collections exposed under `/v1/`. Each is a
 * control-plane surface owned by the PAP (DESIGN §4.4, §8). Kept as an explicit
 * allow-list so a new top-level `/v1/<x>` path is NOT silently routed anywhere —
 * unknown paths 404 at the edge rather than leaking to an arbitrary upstream.
 */
const AUTHZ_ADMIN_V1_COLLECTIONS = [
  'tenants',
  'org-units',
  'roles',
  'permissions',
  'role-assignments',
  'policies',
] as const;

/**
 * Pure, framework-free routing logic (DESIGN §4.1 routing). Maps an inbound
 * request path to its upstream target. Authoritative routing rules:
 *
 *   /auth/*, /v1/auth/*                       -> identity     (PUBLIC — login/refresh)
 *   /v1/expenses, /v1/expenses/*              -> expense      (authenticated)
 *   /v1/audit, /v1/audit/*                    -> audit        (authenticated)
 *   /v1/{tenants|org-units|roles|permissions
 *       |role-assignments|policies}[/*]       -> authz-admin  (authenticated)
 *   /admin/*                                  -> authz-admin  (authenticated)
 *
 * Returns null for anything else (the controller renders a 404). The matcher is
 * exact-or-prefixed and anchored on a path SEGMENT boundary so `/v1/expensesX`
 * does NOT match `/v1/expenses` (a path-confusion / route-smuggling defense).
 */
export function resolveRoute(path: string): RouteTarget | null {
  const normalized = normalizePath(path);

  // The auth surface is public: the user is acquiring a token (no identity yet).
  // The identity service serves it under the versioned `/v1/auth/*` path, so the
  // browser client (which speaks /v1) reaches it through the gateway; the legacy
  // unversioned `/auth/*` is kept for back-compat with direct callers.
  if (segmentMatch(normalized, '/auth') || segmentMatch(normalized, '/v1/auth')) {
    return { upstream: 'identity', requiresAuth: false };
  }

  if (segmentMatch(normalized, '/admin')) {
    return { upstream: 'authz-admin', requiresAuth: true };
  }

  if (segmentMatch(normalized, '/v1/expenses')) {
    return { upstream: 'expense', requiresAuth: true };
  }

  // Read-only decision log for the demo explainer. The audit read endpoint scopes
  // by the `?tenantId=` query (a service contract); the route is authenticated so
  // only a holder of a valid JWT (e.g. the org_admin) can reach it at the edge.
  if (segmentMatch(normalized, '/v1/audit')) {
    return { upstream: 'audit', requiresAuth: true };
  }

  for (const collection of AUTHZ_ADMIN_V1_COLLECTIONS) {
    if (segmentMatch(normalized, `/v1/${collection}`)) {
      return { upstream: 'authz-admin', requiresAuth: true };
    }
  }

  return null;
}

/**
 * True when `path` equals `prefix` or starts with `prefix/` — i.e. `prefix` is a
 * whole leading path segment, never a substring of a longer segment.
 */
function segmentMatch(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** Collapses a trailing slash (except root) and guarantees a leading slash. */
function normalizePath(path: string): string {
  const withLeading = path.startsWith('/') ? path : `/${path}`;
  if (withLeading.length > 1 && withLeading.endsWith('/')) {
    return withLeading.slice(0, -1);
  }
  return withLeading;
}

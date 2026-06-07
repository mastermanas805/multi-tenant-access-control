/** A named downstream service the gateway can route to. */
export type UpstreamName = 'identity' | 'authz-admin' | 'expense' | 'audit';

/**
 * A resolved routing target: which upstream service, and whether the route
 * requires a verified end-user identity (authenticated) or is public (the auth
 * surface, where the user has no token yet).
 */
export interface RouteTarget {
  readonly upstream: UpstreamName;
  /**
   * When true the gateway must have a verified identity before forwarding and
   * injects the signed internal token. When false (the /auth/* surface) the call
   * is forwarded WITHOUT an identity (the user is logging in / refreshing).
   */
  readonly requiresAuth: boolean;
}

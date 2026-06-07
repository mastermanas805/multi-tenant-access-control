import { type UpstreamName } from './upstream';

/**
 * Port resolving a logical upstream name to its base URL (DESIGN §4.1). Kept as a
 * port so routing stays config-driven (nothing hardcoded) and the use-case is
 * testable with a fake registry. The infrastructure adapter reads ConfigService.
 */
export interface UpstreamRegistry {
  baseUrl(upstream: UpstreamName): string;
}

/** DI token for the upstream registry port. */
export const UPSTREAM_REGISTRY = Symbol('UPSTREAM_REGISTRY');

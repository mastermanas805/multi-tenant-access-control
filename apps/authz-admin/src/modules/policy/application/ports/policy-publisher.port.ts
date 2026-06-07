import { type Policy } from '../../domain/policy.entity';

/**
 * Application PORT for publishing a compiled policy to the PDP (DESIGN §3.4, §8.7,
 * FR-8). The publish/activate/rollback use-cases depend ONLY on this interface;
 * the infrastructure layer supplies the adapter that compiles the aggregate's
 * `rule` jsonb into a Cerbos `resourcePolicy` and writes it into the shared disk
 * directory the PDP watches (`watchForChanges` hot-reloads it within seconds).
 *
 * Keeping it a port (not a concrete class) preserves the dependency rule and lets
 * a test bind a no-op/in-memory implementation so the application logic is
 * exercised without a filesystem (the CERBOS_PUBLISH_ENABLED toggle).
 */
export interface PolicyPublisher {
  /**
   * Compiles the aggregate's current rule for its scope/version and makes it
   * effective in the PDP. Idempotent: re-publishing the same (resource, scope)
   * overwrites the file deterministically. Fail-closed: a write error throws so
   * the calling use-case surfaces the failure rather than silently diverging the
   * DB from the PDP (DESIGN §9 D8).
   */
  publish(policy: Policy): Promise<void>;
}

/**
 * DI token for the publisher port. Use-cases inject this token (not the class) so
 * they remain framework- and infrastructure-agnostic.
 */
export const POLICY_PUBLISHER = Symbol('POLICY_PUBLISHER');

import { DomainEvent, type UniqueEntityID } from '@kernel/core';

/**
 * Raised when a tenant is suspended. A subscriber (out of scope here) would
 * revoke active sessions and invalidate PIP caches for the tenant (DESIGN §3.4).
 */
export class TenantSuspendedEvent extends DomainEvent {
  public readonly reason: string;

  constructor(aggregateId: UniqueEntityID, reason: string) {
    super(aggregateId);
    this.reason = reason;
  }

  public eventName(): string {
    return 'tenant.suspended';
  }
}

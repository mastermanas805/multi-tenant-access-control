import { DomainEvent, type UniqueEntityID } from '@kernel/core';

/**
 * Raised when a permission is granted to a role. A subscriber (out of scope here)
 * would invalidate PIP caches for principals holding the role (DESIGN §3.4, FR-8).
 */
export class RolePermissionAddedEvent extends DomainEvent {
  public readonly permission: string;

  constructor(aggregateId: UniqueEntityID, permission: string) {
    super(aggregateId);
    this.permission = permission;
  }

  public eventName(): string {
    return 'role.permission_added';
  }
}

/**
 * Raised when a permission is removed from a role. Drives the dynamic-change
 * propagation (PIP cache invalidation within seconds — DESIGN §3.4, FR-8).
 */
export class RolePermissionRemovedEvent extends DomainEvent {
  public readonly permission: string;

  constructor(aggregateId: UniqueEntityID, permission: string) {
    super(aggregateId);
    this.permission = permission;
  }

  public eventName(): string {
    return 'role.permission_removed';
  }
}

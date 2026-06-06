import { DomainEvent, type UniqueEntityID } from '@kernel/core';

/**
 * Raised when a role assignment is revoked. This is the dynamic-management seam
 * of DESIGN §3.4 (FR-8): the PAP persists, then emits this event onto the bus so
 * PIP caches invalidate the affected principal within seconds — the next
 * authorization check fetches fresh roles and the revoked access becomes a DENY.
 *
 * Carries IDs not payloads (tenant + user + role) so the bus message stays small
 * and the subscriber re-reads the source of truth.
 */
export class RoleAssignmentRevokedEvent extends DomainEvent {
  public readonly tenantId: string;
  public readonly userId: string;
  public readonly roleId: string;

  constructor(
    aggregateId: UniqueEntityID,
    payload: { tenantId: string; userId: string; roleId: string },
  ) {
    super(aggregateId);
    this.tenantId = payload.tenantId;
    this.userId = payload.userId;
    this.roleId = payload.roleId;
  }

  public eventName(): string {
    return 'role_assignment.revoked';
  }
}

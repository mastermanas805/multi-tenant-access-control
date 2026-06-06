import { DomainEvent, type UniqueEntityID } from '@kernel/core';

/**
 * Raised when an org-unit is moved (re-parented). A subscriber (out of scope
 * here) would recompute Cerbos scope bindings and invalidate PIP caches for the
 * affected subtree (DESIGN §3.4, §8.5).
 */
export class OrgUnitMovedEvent extends DomainEvent {
  public readonly fromPath: string;
  public readonly toPath: string;
  public readonly newParentId: string | null;

  constructor(
    aggregateId: UniqueEntityID,
    fromPath: string,
    toPath: string,
    newParentId: string | null,
  ) {
    super(aggregateId);
    this.fromPath = fromPath;
    this.toPath = toPath;
    this.newParentId = newParentId;
  }

  public eventName(): string {
    return 'org_unit.moved';
  }
}

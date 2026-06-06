import { AggregateRoot, Guard, UniqueEntityID } from '@kernel/core';

import { RoleAssignmentRevokedEvent } from './role-assignment.events';
import { RoleAssignmentStateError } from './role-assignment.errors';
import { ScopePath } from './value-objects/scope-path.vo';

/** Lifecycle status of a role assignment. */
export enum RoleAssignmentStatus {
  Active = 'active',
  Revoked = 'revoked',
}

/** Internal property bag for the RoleAssignment aggregate. */
export interface RoleAssignmentProps {
  tenantId: string;
  userId: string;
  roleId: string;
  scope: ScopePath;
  status: RoleAssignmentStatus;
  /** Optional expiry for delegated/time-boxed grants (DESIGN §3.4); null = no expiry. */
  validUntil: Date | null;
  /** The user that delegated this assignment, when it is a delegation; else null. */
  delegatedBy: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Input for creating a new role assignment. */
export interface CreateRoleAssignmentProps {
  tenantId: string;
  userId: string;
  roleId: string;
  scope: ScopePath;
  validUntil?: Date | null;
  delegatedBy?: string | null;
  now: Date;
}

/** Snapshot used to rehydrate a role assignment from persistence (mapper builds this). */
export interface RoleAssignmentSnapshot {
  id: string;
  tenantId: string;
  userId: string;
  roleId: string;
  scope: string;
  status: RoleAssignmentStatus;
  validUntil: Date | null;
  delegatedBy: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const ID_MAX_LENGTH = 255;

/**
 * RoleAssignment aggregate root. Binds a (user, role) to an org-unit scope within
 * a tenant (DESIGN §8 ER model: ROLE_ASSIGNMENT). Owns its lifecycle invariants
 * and raises RoleAssignmentRevokedEvent on revocation — the dynamic-management
 * seam (DESIGN §3.4) that drives PIP cache invalidation within seconds.
 */
export class RoleAssignment extends AggregateRoot<RoleAssignmentProps> {
  private constructor(props: RoleAssignmentProps, id: UniqueEntityID) {
    super(props, id);
  }

  // --- Factory (new aggregate) ------------------------------------------------

  public static create(props: CreateRoleAssignmentProps): RoleAssignment {
    Guard.againstEmpty(props.tenantId, 'tenantId');
    Guard.againstEmpty(props.userId, 'userId');
    Guard.againstEmpty(props.roleId, 'roleId');
    Guard.invariant(props.userId.length <= ID_MAX_LENGTH, 'userId too long', 'user_id_too_long');
    Guard.invariant(props.roleId.length <= ID_MAX_LENGTH, 'roleId too long', 'role_id_too_long');

    const validUntil = props.validUntil ?? null;
    if (validUntil !== null) {
      Guard.invariant(
        validUntil.getTime() > props.now.getTime(),
        'validUntil must be in the future',
        'valid_until_in_past',
      );
    }

    const delegatedBy = props.delegatedBy ?? null;
    if (delegatedBy !== null) {
      Guard.againstEmpty(delegatedBy, 'delegatedBy');
    }

    return new RoleAssignment(
      {
        tenantId: props.tenantId,
        userId: props.userId,
        roleId: props.roleId,
        scope: props.scope,
        status: RoleAssignmentStatus.Active,
        validUntil,
        delegatedBy,
        version: 1,
        createdAt: props.now,
        updatedAt: props.now,
      },
      new UniqueEntityID(),
    );
  }

  // --- Rehydration (from persistence) ----------------------------------------

  public static fromSnapshot(snapshot: RoleAssignmentSnapshot): RoleAssignment {
    return new RoleAssignment(
      {
        tenantId: snapshot.tenantId,
        userId: snapshot.userId,
        roleId: snapshot.roleId,
        scope: ScopePath.fromString(snapshot.scope),
        status: snapshot.status,
        validUntil: snapshot.validUntil,
        delegatedBy: snapshot.delegatedBy,
        version: snapshot.version,
        createdAt: snapshot.createdAt,
        updatedAt: snapshot.updatedAt,
      },
      new UniqueEntityID(snapshot.id),
    );
  }

  // --- Getters ---------------------------------------------------------------

  public get tenantId(): string {
    return this.props.tenantId;
  }

  public get userId(): string {
    return this.props.userId;
  }

  public get roleId(): string {
    return this.props.roleId;
  }

  public get scope(): ScopePath {
    return this.props.scope;
  }

  public get status(): RoleAssignmentStatus {
    return this.props.status;
  }

  public get validUntil(): Date | null {
    return this.props.validUntil;
  }

  public get delegatedBy(): string | null {
    return this.props.delegatedBy;
  }

  public get version(): number {
    return this.props.version;
  }

  public get createdAt(): Date {
    return this.props.createdAt;
  }

  public get updatedAt(): Date {
    return this.props.updatedAt;
  }

  public get isActive(): boolean {
    return this.props.status === RoleAssignmentStatus.Active;
  }

  // --- Behavior (invariant-protected transitions) ----------------------------

  /**
   * Revokes an active assignment and raises RoleAssignmentRevokedEvent (DESIGN
   * §3.4). Re-revoking is rejected to surface caller bugs (idempotency is the
   * caller's concern via the Idempotency-Key header, DESIGN §8.1).
   */
  public revoke(now: Date): void {
    if (this.props.status === RoleAssignmentStatus.Revoked) {
      throw new RoleAssignmentStateError(
        'Role assignment is already revoked',
        'role_assignment_already_revoked',
      );
    }
    this.props.status = RoleAssignmentStatus.Revoked;
    this.touch(now);
    this.addDomainEvent(
      new RoleAssignmentRevokedEvent(this.id, {
        tenantId: this.props.tenantId,
        userId: this.props.userId,
        roleId: this.props.roleId,
      }),
    );
  }

  private touch(now: Date): void {
    this.props.updatedAt = now;
    this.props.version += 1;
  }
}

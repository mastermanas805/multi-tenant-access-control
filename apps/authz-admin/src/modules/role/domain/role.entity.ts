import { AggregateRoot, Guard, UniqueEntityID } from '@kernel/core';

import { RolePermissionAddedEvent, RolePermissionRemovedEvent } from './role.events';
import { RolePermissionError } from './role.errors';
import { PermissionKey } from './value-objects/permission-key.vo';

/** Internal property bag for the Role aggregate. */
export interface RoleProps {
  tenantId: string;
  key: string;
  scope: string;
  description: string;
  permissions: PermissionKey[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Input for creating a new role. */
export interface CreateRoleProps {
  tenantId: string;
  key: string;
  scope: string;
  description?: string;
  permissions?: string[];
  now: Date;
}

/** Snapshot used to rehydrate a role from persistence (the mapper builds this). */
export interface RoleSnapshot {
  id: string;
  tenantId: string;
  key: string;
  scope: string;
  description: string;
  permissions: string[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const KEY_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const SCOPE_PATTERN = /^[a-z0-9]+(?:\.[a-z0-9]+)*$/;

/**
 * Role aggregate root (DESIGN §3 — the RBAC base). A tenant-defined, scope-bound
 * bundle of permissions. Owns its invariants (key shape, scope shape, no
 * duplicate grants) and raises domain events when its permission set changes so
 * downstream PIP caches can be invalidated (FR-8).
 *
 * Uniqueness of `key` per tenant is enforced at the use-case + DB layers (it
 * needs the repository); the aggregate guards everything that is purely local.
 */
export class Role extends AggregateRoot<RoleProps> {
  private constructor(props: RoleProps, id: UniqueEntityID) {
    super(props, id);
  }

  // --- Factory (new aggregate) ------------------------------------------------

  public static create(props: CreateRoleProps): Role {
    Guard.againstEmpty(props.tenantId, 'tenantId');
    Guard.againstEmpty(props.key, 'key');
    Guard.againstEmpty(props.scope, 'scope');
    Guard.invariant(KEY_PATTERN.test(props.key), 'key must be snake_case', 'key_format');
    Guard.invariant(props.key.length <= 100, 'key too long', 'key_too_long');
    Guard.invariant(
      SCOPE_PATTERN.test(props.scope),
      'scope must be a dotted org path',
      'scope_format',
    );
    Guard.invariant(
      (props.description ?? '').length <= 500,
      'description too long',
      'description_too_long',
    );

    const permissions = (props.permissions ?? []).map((p) => PermissionKey.fromString(p));
    const deduped = Role.dedupe(permissions);

    return new Role(
      {
        tenantId: props.tenantId,
        key: props.key,
        scope: props.scope,
        description: (props.description ?? '').trim(),
        permissions: deduped,
        version: 1,
        createdAt: props.now,
        updatedAt: props.now,
      },
      new UniqueEntityID(),
    );
  }

  // --- Rehydration (from persistence) ----------------------------------------

  public static fromSnapshot(snapshot: RoleSnapshot): Role {
    return new Role(
      {
        tenantId: snapshot.tenantId,
        key: snapshot.key,
        scope: snapshot.scope,
        description: snapshot.description,
        permissions: snapshot.permissions.map((p) => PermissionKey.fromString(p)),
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

  public get key(): string {
    return this.props.key;
  }

  public get scope(): string {
    return this.props.scope;
  }

  public get description(): string {
    return this.props.description;
  }

  /** The granted permission keys (defensive copy as plain strings). */
  public get permissions(): string[] {
    return this.props.permissions.map((p) => p.toString());
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

  // --- Behavior (invariant-protected transitions) ----------------------------

  /** Grants a permission to the role. Re-granting an existing one is rejected. */
  public addPermission(permission: string, now: Date): void {
    const key = PermissionKey.fromString(permission);
    if (this.props.permissions.some((p) => p.equals(key))) {
      throw new RolePermissionError(
        `Permission "${permission}" is already granted to this role`,
        'role_permission_already_granted',
      );
    }
    this.props.permissions.push(key);
    this.touch(now);
    this.addDomainEvent(new RolePermissionAddedEvent(this.id, key.toString()));
  }

  /** Removes a permission from the role. Removing a missing one is rejected. */
  public removePermission(permission: string, now: Date): void {
    const key = PermissionKey.fromString(permission);
    const index = this.props.permissions.findIndex((p) => p.equals(key));
    if (index === -1) {
      throw new RolePermissionError(
        `Permission "${permission}" is not granted to this role`,
        'role_permission_not_granted',
      );
    }
    this.props.permissions.splice(index, 1);
    this.touch(now);
    this.addDomainEvent(new RolePermissionRemovedEvent(this.id, key.toString()));
  }

  private touch(now: Date): void {
    this.props.updatedAt = now;
    this.props.version += 1;
  }

  /** Drops duplicate permission keys, preserving first-seen order. */
  private static dedupe(permissions: PermissionKey[]): PermissionKey[] {
    const seen = new Set<string>();
    const result: PermissionKey[] = [];
    for (const p of permissions) {
      const value = p.toString();
      if (!seen.has(value)) {
        seen.add(value);
        result.push(p);
      }
    }
    return result;
  }
}

import { AggregateRoot, Guard, UniqueEntityID } from '@kernel/core';

import { PermissionCreatedEvent } from './permission.events';
import { PermissionId } from './value-objects/permission-id.vo';
import { PermissionKey } from './value-objects/permission-key.vo';

/** Internal property bag for the Permission aggregate. */
export interface PermissionProps {
  key: PermissionKey;
  description: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Input for registering a new permission in the global catalog. */
export interface CreatePermissionProps {
  key: string;
  description: string;
  now: Date;
}

/** Snapshot used to rehydrate a permission from persistence (the mapper builds this). */
export interface PermissionSnapshot {
  id: string;
  key: string;
  description: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const MAX_DESCRIPTION_LENGTH = 500;

/**
 * Permission aggregate root — an entry in the GLOBAL capability catalog
 * (`service:resource:action`, e.g. `expense:report:approve`). The catalog is
 * platform-wide, NOT tenant-scoped: tenant roles reference these keys (DESIGN
 * §8 PERMISSION { uuid id; string key }), so the table carries no `tenant_id`
 * and has no RLS policy.
 */
export class Permission extends AggregateRoot<PermissionProps> {
  private constructor(props: PermissionProps, id: UniqueEntityID) {
    super(props, id);
  }

  // --- Factory (new aggregate) ------------------------------------------------

  public static create(props: CreatePermissionProps): Permission {
    Guard.againstEmpty(props.description, 'description');
    Guard.invariant(
      props.description.length <= MAX_DESCRIPTION_LENGTH,
      'description too long',
      'description_too_long',
    );

    const permission = new Permission(
      {
        key: PermissionKey.fromString(props.key),
        description: props.description.trim(),
        version: 1,
        createdAt: props.now,
        updatedAt: props.now,
      },
      new UniqueEntityID(),
    );
    // The catalog-registration event is intrinsic to creation (mirrors
    // Policy.publish), so callers can't forget to raise it (DESIGN §3.4 seam).
    permission.addDomainEvent(
      new PermissionCreatedEvent(permission.id, permission.props.key.toString()),
    );
    return permission;
  }

  // --- Rehydration (from persistence) ----------------------------------------

  public static fromSnapshot(snapshot: PermissionSnapshot): Permission {
    return new Permission(
      {
        key: PermissionKey.fromString(snapshot.key),
        description: snapshot.description,
        version: snapshot.version,
        createdAt: snapshot.createdAt,
        updatedAt: snapshot.updatedAt,
      },
      new UniqueEntityID(snapshot.id),
    );
  }

  // --- Getters ---------------------------------------------------------------

  public get permissionId(): PermissionId {
    return PermissionId.fromString(this.id.toString());
  }

  public get key(): PermissionKey {
    return this.props.key;
  }

  public get description(): string {
    return this.props.description;
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
}

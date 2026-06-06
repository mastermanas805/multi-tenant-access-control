import { AggregateRoot, Guard, UniqueEntityID } from '@kernel/core';

import { TenantSuspendedEvent } from './tenant.events';
import { TenantStatusError } from './tenant.errors';
import { IsolationTier } from './value-objects/isolation-tier.vo';
import { TenantId } from './value-objects/tenant-id.vo';

/** Lifecycle status of a tenant. */
export enum TenantStatus {
  Active = 'active',
  Suspended = 'suspended',
}

/** Internal property bag for the Tenant aggregate. */
export interface TenantProps {
  name: string;
  slug: string;
  status: TenantStatus;
  isolationTier: IsolationTier;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Input for creating a new tenant. */
export interface CreateTenantProps {
  name: string;
  slug: string;
  isolationTier?: IsolationTier;
  now: Date;
}

/** Snapshot used to rehydrate a tenant from persistence (the mapper builds this). */
export interface TenantSnapshot {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  isolationTier: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Tenant aggregate root. Owns its lifecycle invariants and raises domain events
 * for state transitions that downstream systems care about (e.g. suspension ->
 * revoke sessions / invalidate caches).
 */
export class Tenant extends AggregateRoot<TenantProps> {
  private constructor(props: TenantProps, id: UniqueEntityID) {
    super(props, id);
  }

  // --- Factory (new aggregate) ------------------------------------------------

  public static create(props: CreateTenantProps): Tenant {
    Guard.againstEmpty(props.name, 'name');
    Guard.againstEmpty(props.slug, 'slug');
    Guard.invariant(SLUG_PATTERN.test(props.slug), 'slug must be kebab-case', 'slug_format');
    Guard.invariant(props.name.length <= 200, 'name too long', 'name_too_long');

    return new Tenant(
      {
        name: props.name.trim(),
        slug: props.slug,
        status: TenantStatus.Active,
        isolationTier: props.isolationTier ?? IsolationTier.default(),
        version: 1,
        createdAt: props.now,
        updatedAt: props.now,
      },
      new UniqueEntityID(),
    );
  }

  // --- Rehydration (from persistence) ----------------------------------------

  public static fromSnapshot(snapshot: TenantSnapshot): Tenant {
    return new Tenant(
      {
        name: snapshot.name,
        slug: snapshot.slug,
        status: snapshot.status,
        isolationTier: IsolationTier.fromString(snapshot.isolationTier),
        version: snapshot.version,
        createdAt: snapshot.createdAt,
        updatedAt: snapshot.updatedAt,
      },
      new UniqueEntityID(snapshot.id),
    );
  }

  // --- Getters ---------------------------------------------------------------

  public get tenantId(): TenantId {
    return TenantId.fromString(this.id.toString());
  }

  public get name(): string {
    return this.props.name;
  }

  public get slug(): string {
    return this.props.slug;
  }

  public get status(): TenantStatus {
    return this.props.status;
  }

  public get isolationTier(): IsolationTier {
    return this.props.isolationTier;
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
    return this.props.status === TenantStatus.Active;
  }

  // --- Behavior (invariant-protected transitions) ----------------------------

  /** Suspends an active tenant. Idempotency is rejected to surface caller bugs. */
  public suspend(reason: string, now: Date): void {
    if (this.props.status === TenantStatus.Suspended) {
      throw new TenantStatusError('Tenant is already suspended', 'tenant_already_suspended');
    }
    this.props.status = TenantStatus.Suspended;
    this.touch(now);
    this.addDomainEvent(new TenantSuspendedEvent(this.id, reason));
  }

  /** Reactivates a suspended tenant. */
  public activate(now: Date): void {
    if (this.props.status === TenantStatus.Active) {
      throw new TenantStatusError('Tenant is already active', 'tenant_already_active');
    }
    this.props.status = TenantStatus.Active;
    this.touch(now);
  }

  private touch(now: Date): void {
    this.props.updatedAt = now;
    this.props.version += 1;
  }
}

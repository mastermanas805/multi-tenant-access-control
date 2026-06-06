import { AggregateRoot, Guard, UniqueEntityID } from '@kernel/core';

import { PolicyPublishedEvent } from './policy.events';
import { PolicyStatusError } from './policy.errors';
import { PolicyScope } from './value-objects/policy-scope.vo';

/** Lifecycle status of a policy version. */
export enum PolicyStatus {
  /** Published but not yet enforced — awaits activation (DESIGN §8.2). */
  Staged = 'staged',
  /** The version currently enforced for its scope. */
  Active = 'active',
}

/** Opaque JSON policy rule body (the Cerbos rule lives in Git; PAP stores metadata). */
export type PolicyRule = Record<string, unknown>;

/** Internal property bag for the Policy aggregate. */
export interface PolicyProps {
  /**
   * Owning tenant. A freshly published aggregate is tenant-agnostic (the value
   * is unknown until the repository stamps it from the ambient tenant context on
   * save — DESIGN §6), so it is `null` until then; rehydrated aggregates carry the
   * value from their row. Never the invalid empty string.
   */
  tenantId: string | null;
  scope: PolicyScope;
  rule: PolicyRule;
  status: PolicyStatus;
  /**
   * Monotonic policy version for the scope. Immutable once published — each
   * publish/rollback creates a NEW aggregate with the next version. Distinct from
   * tenant-style mutable versions: status transitions do NOT bump it.
   */
  version: number;
  effectiveDate: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for publishing a new policy version. The owning tenant is NOT passed
 * here: it is the ambient request boundary (DESIGN §6) and is stamped onto the
 * row by the infrastructure layer (repository) from the tenant context, keeping
 * the application layer tenant-agnostic.
 */
export interface PublishPolicyProps {
  scope: PolicyScope;
  rule: PolicyRule;
  /** Monotonic version supplied by the application layer (max existing + 1). */
  version: number;
  effectiveDate: Date;
  now: Date;
}

/** Snapshot used to rehydrate a policy from persistence (the mapper builds this). */
export interface PolicySnapshot {
  id: string;
  tenantId: string;
  scope: string;
  rule: PolicyRule;
  status: PolicyStatus;
  version: number;
  effectiveDate: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Policy aggregate root. Each publish creates a new immutable version for a scope
 * (DESIGN §8.7: the PAP DB holds policy METADATA — scope, version, effectiveDate;
 * the rule logic itself is authored as code in Git and shipped as signed bundles).
 * The aggregate owns its lifecycle invariants and raises a PolicyPublishedEvent so
 * downstream republishes the bundle and invalidates caches (DESIGN §3.4).
 */
export class Policy extends AggregateRoot<PolicyProps> {
  private constructor(props: PolicyProps, id: UniqueEntityID) {
    super(props, id);
  }

  // --- Factory (new aggregate) ------------------------------------------------

  public static publish(props: PublishPolicyProps): Policy {
    Guard.invariant(props.version >= 1, 'version must be >= 1', 'version_invalid');

    const policy = new Policy(
      {
        // Tenant-agnostic until the repository stamps it from the ambient tenant
        // context on save (DESIGN §6); null avoids any invalid placeholder state.
        tenantId: null,
        scope: props.scope,
        rule: props.rule,
        status: PolicyStatus.Staged,
        version: props.version,
        effectiveDate: props.effectiveDate,
        createdAt: props.now,
        updatedAt: props.now,
      },
      new UniqueEntityID(),
    );
    policy.addDomainEvent(
      new PolicyPublishedEvent(policy.id, props.scope.toString(), props.version),
    );
    return policy;
  }

  // --- Rehydration (from persistence) ----------------------------------------

  public static fromSnapshot(snapshot: PolicySnapshot): Policy {
    return new Policy(
      {
        tenantId: snapshot.tenantId,
        scope: PolicyScope.fromString(snapshot.scope),
        rule: snapshot.rule,
        status: snapshot.status,
        version: snapshot.version,
        effectiveDate: snapshot.effectiveDate,
        createdAt: snapshot.createdAt,
        updatedAt: snapshot.updatedAt,
      },
      new UniqueEntityID(snapshot.id),
    );
  }

  // --- Getters ---------------------------------------------------------------

  public get tenantId(): string {
    if (this.props.tenantId === null) {
      throw new Error('Policy tenantId is not yet stamped (call stampTenant on save)');
    }
    return this.props.tenantId;
  }

  public get scope(): PolicyScope {
    return this.props.scope;
  }

  public get rule(): PolicyRule {
    return this.props.rule;
  }

  public get status(): PolicyStatus {
    return this.props.status;
  }

  public get version(): number {
    return this.props.version;
  }

  public get effectiveDate(): Date {
    return this.props.effectiveDate;
  }

  public get createdAt(): Date {
    return this.props.createdAt;
  }

  public get updatedAt(): Date {
    return this.props.updatedAt;
  }

  public get isActive(): boolean {
    return this.props.status === PolicyStatus.Active;
  }

  // --- Behavior (invariant-protected transitions) ----------------------------

  /**
   * Stamps the owning tenant onto a freshly published aggregate. Called by the
   * repository on save from the ambient tenant context (DESIGN §6), keeping the
   * application layer tenant-agnostic. Idempotent for the same tenant; rejects an
   * attempt to re-stamp a different tenant (a cross-tenant safety invariant).
   */
  public stampTenant(tenantId: string): void {
    Guard.againstEmpty(tenantId, 'tenantId');
    if (this.props.tenantId !== null && this.props.tenantId !== tenantId) {
      throw new PolicyStatusError(
        'Policy is already owned by a different tenant',
        'policy_tenant_mismatch',
      );
    }
    this.props.tenantId = tenantId;
  }

  /**
   * Activates a staged policy version. Re-activating an active version is rejected.
   * NOTE: unlike a tenant-style mutable version, the monotonic policy `version` is
   * immutable; activation only changes status + updatedAt (it does NOT bump version).
   */
  public activate(now: Date): void {
    if (this.props.status === PolicyStatus.Active) {
      throw new PolicyStatusError('Policy version is already active', 'policy_already_active');
    }
    this.props.status = PolicyStatus.Active;
    this.touch(now);
  }

  private touch(now: Date): void {
    this.props.updatedAt = now;
  }
}

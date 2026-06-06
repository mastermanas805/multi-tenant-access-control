import { Guard } from '@kernel/core';

/**
 * Data-isolation tier (DESIGN §6):
 *   - pool:   shared DB + RLS (logical isolation) — the default, lowest cost.
 *   - bridge: schema-per-tenant — noisy-neighbor mitigation.
 *   - silo:   DB-per-tenant (physical isolation) — regulated/residency tier.
 */
export enum IsolationTierValue {
  Pool = 'pool',
  Bridge = 'bridge',
  Silo = 'silo',
}

const ALL_TIERS: readonly IsolationTierValue[] = [
  IsolationTierValue.Pool,
  IsolationTierValue.Bridge,
  IsolationTierValue.Silo,
];

/** Value object wrapping the isolation tier with validation + helpers. */
export class IsolationTier {
  private readonly value: IsolationTierValue;

  private constructor(value: IsolationTierValue) {
    this.value = value;
  }

  /** The default tier for new tenants. */
  public static default(): IsolationTier {
    return new IsolationTier(IsolationTierValue.Pool);
  }

  /** Validates and wraps a raw tier string (e.g. from a request DTO). */
  public static fromString(value: string): IsolationTier {
    Guard.oneOf(value as IsolationTierValue, ALL_TIERS, 'isolationTier');
    return new IsolationTier(value as IsolationTierValue);
  }

  public toString(): IsolationTierValue {
    return this.value;
  }

  public equals(other?: IsolationTier): boolean {
    return this.value === other?.value;
  }
}

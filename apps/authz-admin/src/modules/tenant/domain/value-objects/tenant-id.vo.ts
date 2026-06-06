import { UniqueEntityID, ValidationError } from '@kernel/core';

/**
 * Strongly-typed Tenant identity. Wraps a UUID so a TenantId can never be
 * confused with another aggregate's id at compile time.
 */
export class TenantId {
  private readonly value: UniqueEntityID;

  private constructor(value: UniqueEntityID) {
    this.value = value;
  }

  /** Creates a fresh TenantId (new UUID). */
  public static create(): TenantId {
    return new TenantId(new UniqueEntityID());
  }

  /** Rehydrates a TenantId from a persisted UUID string; validates the format. */
  public static fromString(value: string): TenantId {
    if (!UniqueEntityID.isValidUuid(value)) {
      throw new ValidationError('Invalid tenant id', 'tenant_id_invalid');
    }
    return new TenantId(new UniqueEntityID(value));
  }

  public toString(): string {
    return this.value.toString();
  }

  public equals(other?: TenantId): boolean {
    return other !== undefined && this.value.equals(other.value);
  }
}

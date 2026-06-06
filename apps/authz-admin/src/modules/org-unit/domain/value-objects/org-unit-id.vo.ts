import { UniqueEntityID, ValidationError } from '@kernel/core';

/**
 * Strongly-typed OrgUnit identity. Wraps a UUID so an OrgUnitId can never be
 * confused with another aggregate's id at compile time.
 */
export class OrgUnitId {
  private readonly value: UniqueEntityID;

  private constructor(value: UniqueEntityID) {
    this.value = value;
  }

  /** Creates a fresh OrgUnitId (new UUID). */
  public static create(): OrgUnitId {
    return new OrgUnitId(new UniqueEntityID());
  }

  /** Rehydrates an OrgUnitId from a persisted UUID string; validates the format. */
  public static fromString(value: string): OrgUnitId {
    if (!UniqueEntityID.isValidUuid(value)) {
      throw new ValidationError('Invalid org-unit id', 'org_unit_id_invalid');
    }
    return new OrgUnitId(new UniqueEntityID(value));
  }

  public toString(): string {
    return this.value.toString();
  }

  public equals(other?: OrgUnitId): boolean {
    return other !== undefined && this.value.equals(other.value);
  }
}

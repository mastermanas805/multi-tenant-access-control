import { UniqueEntityID, ValidationError } from '@kernel/core';

/**
 * Strongly-typed Role identity. Wraps a UUID so a RoleId can never be confused
 * with another aggregate's id at compile time.
 */
export class RoleId {
  private readonly value: UniqueEntityID;

  private constructor(value: UniqueEntityID) {
    this.value = value;
  }

  /** Creates a fresh RoleId (new UUID). */
  public static create(): RoleId {
    return new RoleId(new UniqueEntityID());
  }

  /** Rehydrates a RoleId from a persisted UUID string; validates the format. */
  public static fromString(value: string): RoleId {
    if (!UniqueEntityID.isValidUuid(value)) {
      throw new ValidationError('Invalid role id', 'role_id_invalid');
    }
    return new RoleId(new UniqueEntityID(value));
  }

  public toString(): string {
    return this.value.toString();
  }

  public equals(other?: RoleId): boolean {
    return other !== undefined && this.value.equals(other.value);
  }
}

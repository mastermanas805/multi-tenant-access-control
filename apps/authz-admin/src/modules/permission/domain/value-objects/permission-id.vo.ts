import { UniqueEntityID, ValidationError } from '@kernel/core';

/**
 * Strongly-typed Permission identity. Wraps a UUID so a PermissionId can never
 * be confused with another aggregate's id at compile time.
 */
export class PermissionId {
  private readonly value: UniqueEntityID;

  private constructor(value: UniqueEntityID) {
    this.value = value;
  }

  /** Creates a fresh PermissionId (new UUID). */
  public static create(): PermissionId {
    return new PermissionId(new UniqueEntityID());
  }

  /** Rehydrates a PermissionId from a persisted UUID string; validates format. */
  public static fromString(value: string): PermissionId {
    if (!UniqueEntityID.isValidUuid(value)) {
      throw new ValidationError('Invalid permission id', 'permission_id_invalid');
    }
    return new PermissionId(new UniqueEntityID(value));
  }

  public toString(): string {
    return this.value.toString();
  }

  public equals(other?: PermissionId): boolean {
    return other !== undefined && this.value.equals(other.value);
  }
}

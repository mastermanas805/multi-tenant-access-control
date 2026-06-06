import { UniqueEntityID, ValidationError } from '@kernel/core';

/**
 * Strongly-typed RoleAssignment identity. Wraps a UUID so a RoleAssignmentId can
 * never be confused with another aggregate's id at compile time.
 */
export class RoleAssignmentId {
  private readonly value: UniqueEntityID;

  private constructor(value: UniqueEntityID) {
    this.value = value;
  }

  /** Creates a fresh RoleAssignmentId (new UUID). */
  public static create(): RoleAssignmentId {
    return new RoleAssignmentId(new UniqueEntityID());
  }

  /** Rehydrates a RoleAssignmentId from a persisted UUID string; validates format. */
  public static fromString(value: string): RoleAssignmentId {
    if (!UniqueEntityID.isValidUuid(value)) {
      throw new ValidationError('Invalid role assignment id', 'role_assignment_id_invalid');
    }
    return new RoleAssignmentId(new UniqueEntityID(value));
  }

  public toString(): string {
    return this.value.toString();
  }

  public equals(other?: RoleAssignmentId): boolean {
    return other !== undefined && this.value.equals(other.value);
  }
}

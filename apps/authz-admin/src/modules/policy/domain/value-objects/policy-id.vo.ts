import { UniqueEntityID, ValidationError } from '@kernel/core';

/**
 * Strongly-typed Policy identity. Wraps a UUID so a PolicyId can never be
 * confused with another aggregate's id at compile time.
 */
export class PolicyId {
  private readonly value: UniqueEntityID;

  private constructor(value: UniqueEntityID) {
    this.value = value;
  }

  /** Creates a fresh PolicyId (new UUID). */
  public static create(): PolicyId {
    return new PolicyId(new UniqueEntityID());
  }

  /** Rehydrates a PolicyId from a persisted UUID string; validates the format. */
  public static fromString(value: string): PolicyId {
    if (!UniqueEntityID.isValidUuid(value)) {
      throw new ValidationError('Invalid policy id', 'policy_id_invalid');
    }
    return new PolicyId(new UniqueEntityID(value));
  }

  public toString(): string {
    return this.value.toString();
  }

  public equals(other?: PolicyId): boolean {
    return other !== undefined && this.value.equals(other.value);
  }
}

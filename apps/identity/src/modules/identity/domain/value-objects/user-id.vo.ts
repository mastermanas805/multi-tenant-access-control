import { UniqueEntityID, ValidationError } from '@kernel/core';

/**
 * Strongly-typed User identity. Wraps a UUID so a UserId can never be confused
 * with another aggregate's id at compile time. The string form becomes the JWT
 * `sub` claim.
 */
export class UserId {
  private readonly value: UniqueEntityID;

  private constructor(value: UniqueEntityID) {
    this.value = value;
  }

  /** Creates a fresh UserId (new UUID). */
  public static create(): UserId {
    return new UserId(new UniqueEntityID());
  }

  /** Rehydrates a UserId from a persisted/seeded UUID string; validates format. */
  public static fromString(value: string): UserId {
    if (!UniqueEntityID.isValidUuid(value)) {
      throw new ValidationError('Invalid user id', 'user_id_invalid');
    }
    return new UserId(new UniqueEntityID(value));
  }

  public toString(): string {
    return this.value.toString();
  }

  public equals(other?: UserId): boolean {
    return other !== undefined && this.value.equals(other.value);
  }
}

import { type Email } from './value-objects/email.vo';
import { type User } from './user.entity';
import { type UserId } from './value-objects/user-id.vo';

/**
 * Repository PORT for the User aggregate. The application layer depends ONLY on
 * this interface; the config-seeded in-memory adapter implements it. The same
 * seam would back a real user store (Postgres/LDAP) without touching use-cases.
 */
export interface UserRepository {
  /** Loads a user by email (the password-grant username), or null. */
  findByEmail(email: Email): Promise<User | null>;

  /** Loads a user by id (used by the refresh grant), or null. */
  findById(id: UserId): Promise<User | null>;
}

/** DI token for the user repository port. */
export const USER_REPOSITORY = Symbol('USER_REPOSITORY');

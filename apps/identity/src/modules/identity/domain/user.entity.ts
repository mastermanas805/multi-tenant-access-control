import { AggregateRoot, Guard, UniqueEntityID } from '@kernel/core';

import { Email } from './value-objects/email.vo';
import { PasswordHash } from './value-objects/password-hash.vo';
import { UserId } from './value-objects/user-id.vo';

/** Internal property bag for the User aggregate. */
export interface UserProps {
  email: Email;
  passwordHash: PasswordHash;
  tenantId: string;
  name?: string;
  active: boolean;
  /**
   * Whether the account holds the PLATFORM-ADMIN scope (DESIGN §6 / App. A). This
   * is an account-level authorization flag, distinct from per-tenant roles (which
   * are still resolved downstream by the PIP — D4). The IdP mints it as the
   * `platform_admin` claim so the control plane can verify it.
   */
  platformAdmin: boolean;
}

/** Snapshot used to rehydrate a User from the seed/persistence layer. */
export interface UserSnapshot {
  id: string;
  email: string;
  passwordHash: string;
  tenantId: string;
  name?: string;
  active?: boolean;
  platformAdmin?: boolean;
}

/**
 * User aggregate root for the identity service. Owns the account's identity,
 * tenant binding and credential reference. Authentication is delegated to the
 * application layer + PasswordHasher port (the aggregate never holds plaintext).
 *
 * NOTE: this aggregate carries IDENTITY + TENANT only — never roles/permissions
 * (DESIGN §5, D4). The issued token mirrors that; effective roles are resolved
 * downstream by the PEP/PIP, so a revocation is enforced within the staleness
 * bound rather than waiting on token expiry.
 */
export class User extends AggregateRoot<UserProps> {
  private constructor(props: UserProps, id: UniqueEntityID) {
    super(props, id);
  }

  /** Rehydrates a User from a seed/persistence snapshot. */
  public static fromSnapshot(snapshot: UserSnapshot): User {
    Guard.againstEmpty(snapshot.tenantId, 'tenantId');
    return new User(
      {
        email: Email.fromString(snapshot.email),
        passwordHash: PasswordHash.fromEncoded(snapshot.passwordHash),
        tenantId: snapshot.tenantId,
        ...(snapshot.name !== undefined ? { name: snapshot.name } : {}),
        active: snapshot.active ?? true,
        platformAdmin: snapshot.platformAdmin ?? false,
      },
      new UniqueEntityID(snapshot.id),
    );
  }

  // --- Getters ---------------------------------------------------------------

  public get userId(): UserId {
    return UserId.fromString(this.id.toString());
  }

  public get email(): Email {
    return this.props.email;
  }

  public get passwordHash(): PasswordHash {
    return this.props.passwordHash;
  }

  public get tenantId(): string {
    return this.props.tenantId;
  }

  public get name(): string | undefined {
    return this.props.name;
  }

  public get isActive(): boolean {
    return this.props.active;
  }

  /** Whether the account holds the platform-admin scope (DESIGN §6 / App. A). */
  public get isPlatformAdmin(): boolean {
    return this.props.platformAdmin;
  }
}

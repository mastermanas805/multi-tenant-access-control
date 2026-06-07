import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';

import { ConfigService } from '../../../config/config.service';
import { type PasswordHasher, PASSWORD_HASHER } from '../domain/password-hasher.port';
import { User } from '../domain/user.entity';
import { type UserRepository } from '../domain/user.repository.port';
import { type Email } from '../domain/value-objects/email.vo';
import { type UserId } from '../domain/value-objects/user-id.vo';

/**
 * Config-seeded, in-memory user store. At boot it hashes each seeded user's
 * plaintext password (the dev seed) into a scrypt hash and builds the User
 * aggregate, so no plaintext is retained in memory after init. A real IdP would
 * back the UserRepository port with Postgres/LDAP — the use-cases never change.
 *
 * Indexed by both email (password-grant lookup) and id (refresh-grant lookup).
 */
@Injectable()
export class ConfigUserRepository implements UserRepository, OnModuleInit {
  private readonly byEmail = new Map<string, User>();
  private readonly byId = new Map<string, User>();

  constructor(
    private readonly config: ConfigService,
    @Inject(PASSWORD_HASHER) private readonly passwords: PasswordHasher,
  ) {}

  public async onModuleInit(): Promise<void> {
    for (const seed of this.config.seedUserConfigs) {
      const passwordHash = await this.passwords.hash(seed.password);
      const user = User.fromSnapshot({
        id: seed.id,
        email: seed.email,
        passwordHash: passwordHash.toString(),
        tenantId: seed.tenantId,
        ...(seed.name !== undefined ? { name: seed.name } : {}),
        active: true,
        ...(seed.platformAdmin ? { platformAdmin: true } : {}),
      });
      this.byEmail.set(user.email.toString(), user);
      this.byId.set(user.userId.toString(), user);
    }
  }

  public findByEmail(email: Email): Promise<User | null> {
    return Promise.resolve(this.byEmail.get(email.toString()) ?? null);
  }

  public findById(id: UserId): Promise<User | null> {
    return Promise.resolve(this.byId.get(id.toString()) ?? null);
  }
}

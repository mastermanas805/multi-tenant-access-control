import { Inject, Injectable } from '@nestjs/common';

import { Email } from '../../domain/value-objects/email.vo';
import { InvalidCredentialsError } from '../../domain/identity.errors';
import { type PasswordHasher, PASSWORD_HASHER } from '../../domain/password-hasher.port';
import { type UserRepository, USER_REPOSITORY } from '../../domain/user.repository.port';
import { type IssueTokenCommand } from '../dto/auth.commands';
import { type TokenView } from '../dto/token.view';
import { TokenPairFactory } from '../token-pair.factory';

/**
 * OIDC password grant: authenticate a user by email + password and mint a token
 * pair (DESIGN §5). Fail-closed: any failure — unknown user, disabled account,
 * wrong password — throws the SAME generic InvalidCredentialsError (401) so the
 * endpoint cannot be used to enumerate accounts (DESIGN §7 / §10). Password
 * verification is constant-time (behind the PasswordHasher port).
 */
@Injectable()
export class IssueTokenUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PASSWORD_HASHER) private readonly passwords: PasswordHasher,
    private readonly tokens: TokenPairFactory,
  ) {}

  public async execute(command: IssueTokenCommand): Promise<TokenView> {
    const email = Email.fromString(command.email);
    const user = await this.users.findByEmail(email);

    // Always run a real verify — against the user's hash, or a dummy hash when
    // the user is absent — so login latency does not leak whether an email
    // exists (timing enumeration oracle, DESIGN §7 / §10).
    const hashToCheck = user !== null ? user.passwordHash : this.passwords.dummyHash();
    const passwordMatches = await this.passwords.verify(command.password, hashToCheck);

    // Collapse every failure into one generic error (no enumeration oracle).
    if (user === null || !user.isActive || !passwordMatches) {
      throw new InvalidCredentialsError();
    }

    return this.tokens.issueFor({ user });
  }
}

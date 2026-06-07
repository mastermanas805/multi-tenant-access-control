import { Inject, Injectable } from '@nestjs/common';

import { type Clock, CLOCK } from '@kernel/core';

import { InvalidRefreshTokenError } from '../../domain/identity.errors';
import {
  type RefreshTokenStore,
  REFRESH_TOKEN_STORE,
} from '../../domain/refresh-token-store.port';
import { type UserRepository, USER_REPOSITORY } from '../../domain/user.repository.port';
import { UserId } from '../../domain/value-objects/user-id.vo';
import { type RefreshTokenCommand } from '../dto/auth.commands';
import { type TokenView } from '../dto/token.view';
import { TokenPairFactory } from '../token-pair.factory';

/**
 * OIDC refresh grant: exchange a valid refresh token for a NEW token pair,
 * keeping the same session id. Implements refresh-token ROTATION — `consume`
 * atomically removes the presented token, so a replayed (stolen) token is
 * rejected after first use (DESIGN §7). Fail-closed: unknown, expired, or
 * orphaned (user gone/disabled) tokens all raise InvalidRefreshTokenError (401).
 */
@Injectable()
export class RefreshTokenUseCase {
  constructor(
    @Inject(REFRESH_TOKEN_STORE) private readonly refreshTokens: RefreshTokenStore,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly tokens: TokenPairFactory,
  ) {}

  public async execute(command: RefreshTokenCommand): Promise<TokenView> {
    const record = await this.refreshTokens.consume(command.refreshToken);
    if (record === null) {
      throw new InvalidRefreshTokenError();
    }

    const nowSeconds = Math.floor(this.clock.now().getTime() / 1000);
    if (record.expiresAt <= nowSeconds) {
      throw new InvalidRefreshTokenError('refresh_token_expired');
    }

    const user = await this.users.findById(UserId.fromString(record.userId));
    if (!user?.isActive) {
      throw new InvalidRefreshTokenError('refresh_token_orphaned');
    }

    // Keep the session id so the session survives token rotation.
    return this.tokens.issueFor({ user, sessionId: record.sessionId });
  }
}

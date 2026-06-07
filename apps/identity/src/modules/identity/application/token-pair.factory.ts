import { Inject, Injectable } from '@nestjs/common';

import { type Clock, CLOCK } from '@kernel/core';

import {
  type RefreshTokenStore,
  REFRESH_TOKEN_STORE,
} from '../domain/refresh-token-store.port';
import { type SecretGenerator, SECRET_GENERATOR } from '../domain/secret-generator.port';
import { type TokenSigner, TOKEN_SIGNER } from '../domain/token-signer.port';
import { type User } from '../domain/user.entity';
import { type TokenView } from './dto/token.view';
import {
  type TokenIssuancePolicy,
  TOKEN_ISSUANCE_POLICY,
} from './token-issuance.policy';

/** Inputs that vary per grant when minting a token pair. */
export interface TokenPairContext {
  user: User;
  /**
   * Reuse an existing session id (refresh grant keeps the session) or omit to
   * mint a new one (password grant starts a fresh session).
   */
  sessionId?: string;
}

/**
 * Shared application service that assembles an access + refresh token pair for a
 * user. Used by BOTH the password and refresh grants so the claim shape, TTLs
 * and refresh-token persistence stay identical across grant types.
 *
 * The minted access token carries IDENTITY + TENANT only (sub/tid/sid/act) — no
 * roles/permissions (DESIGN §5, D4). `act` equals `sub` for a direct login.
 */
@Injectable()
export class TokenPairFactory {
  constructor(
    @Inject(TOKEN_SIGNER) private readonly signer: TokenSigner,
    @Inject(REFRESH_TOKEN_STORE) private readonly refreshTokens: RefreshTokenStore,
    @Inject(SECRET_GENERATOR) private readonly secrets: SecretGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(TOKEN_ISSUANCE_POLICY) private readonly policy: TokenIssuancePolicy,
  ) {}

  public async issueFor(context: TokenPairContext): Promise<TokenView> {
    const { user } = context;
    const nowSeconds = Math.floor(this.clock.now().getTime() / 1000);
    const sessionId = context.sessionId ?? this.secrets.sessionId();
    const sub = user.userId.toString();

    const signed = this.signer.signAccessToken(
      {
        sub,
        tid: user.tenantId,
        sid: sessionId,
        act: sub,
        iss: this.policy.issuer,
        aud: this.policy.audience,
      },
      nowSeconds,
      this.policy.accessTokenTtlSeconds,
    );

    const refreshToken = this.secrets.refreshToken();
    await this.refreshTokens.save({
      token: refreshToken,
      userId: sub,
      tenantId: user.tenantId,
      sessionId,
      expiresAt: nowSeconds + this.policy.refreshTokenTtlSeconds,
    });

    return {
      accessToken: signed.token,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.policy.accessTokenTtlSeconds,
      sub,
      tid: user.tenantId,
      sid: sessionId,
    };
  }
}

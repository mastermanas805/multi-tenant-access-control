import { Module } from '@nestjs/common';

import { ConfigService } from '../../config/config.service';
import {
  type TokenIssuancePolicy,
  TOKEN_ISSUANCE_POLICY,
} from './application/token-issuance.policy';
import { TokenPairFactory } from './application/token-pair.factory';
import { GetJwksUseCase } from './application/use-cases/get-jwks.use-case';
import { IssueTokenUseCase } from './application/use-cases/issue-token.use-case';
import { RefreshTokenUseCase } from './application/use-cases/refresh-token.use-case';
import { PASSWORD_HASHER } from './domain/password-hasher.port';
import { REFRESH_TOKEN_STORE } from './domain/refresh-token-store.port';
import { SECRET_GENERATOR } from './domain/secret-generator.port';
import { TOKEN_SIGNER } from './domain/token-signer.port';
import { USER_REPOSITORY } from './domain/user.repository.port';
import { ConfigUserRepository } from './infrastructure/config-user.repository';
import { CryptoSecretGenerator } from './infrastructure/crypto-secret-generator';
import { CryptoTokenSigner } from './infrastructure/crypto-token-signer';
import { InMemoryRefreshTokenStore } from './infrastructure/in-memory-refresh-token.store';
import { ScryptPasswordHasher } from './infrastructure/scrypt-password-hasher';
import { AuthController } from './presentation/auth.controller';
import { JwksController } from './presentation/jwks.controller';

/**
 * Wires the Identity feature module (hexagonal):
 *   - controllers (presentation): AuthController, JwksController,
 *   - use-cases + TokenPairFactory (application),
 *   - the PORT tokens -> their adapters (infrastructure):
 *       USER_REPOSITORY      -> ConfigUserRepository (config-seeded)
 *       PASSWORD_HASHER      -> ScryptPasswordHasher
 *       TOKEN_SIGNER         -> CryptoTokenSigner (RS256 + JWKS)
 *       SECRET_GENERATOR     -> CryptoSecretGenerator (CSPRNG)
 *       REFRESH_TOKEN_STORE  -> InMemoryRefreshTokenStore (rotation)
 *   - TOKEN_ISSUANCE_POLICY: a value provider derived from the typed config, so
 *     the application layer reads issuer/audience/TTLs via a port, not config.
 *
 * The CLOCK port comes from the global SharedModule. This mirrors the authz-admin
 * feature-module pattern (controller + use-cases + {provide: TOKEN, useClass}).
 */
@Module({
  controllers: [AuthController, JwksController],
  providers: [
    IssueTokenUseCase,
    RefreshTokenUseCase,
    GetJwksUseCase,
    TokenPairFactory,
    { provide: USER_REPOSITORY, useClass: ConfigUserRepository },
    { provide: PASSWORD_HASHER, useClass: ScryptPasswordHasher },
    { provide: TOKEN_SIGNER, useClass: CryptoTokenSigner },
    { provide: SECRET_GENERATOR, useClass: CryptoSecretGenerator },
    { provide: REFRESH_TOKEN_STORE, useClass: InMemoryRefreshTokenStore },
    {
      provide: TOKEN_ISSUANCE_POLICY,
      inject: [ConfigService],
      useFactory: (config: ConfigService): TokenIssuancePolicy => ({
        issuer: config.values.IDENTITY_ISSUER,
        audience: config.values.IDENTITY_AUDIENCE,
        accessTokenTtlSeconds: config.values.ACCESS_TOKEN_TTL_SECONDS,
        refreshTokenTtlSeconds: config.values.REFRESH_TOKEN_TTL_SECONDS,
      }),
    },
  ],
})
export class IdentityModule {}

import { type Clock } from '@kernel/core';

import { type TokenIssuancePolicy } from '../application/token-issuance.policy';
import { TokenPairFactory } from '../application/token-pair.factory';
import { RefreshTokenUseCase } from '../application/use-cases/refresh-token.use-case';
import { InvalidRefreshTokenError } from '../domain/identity.errors';
import {
  type RefreshTokenRecord,
  type RefreshTokenStore,
} from '../domain/refresh-token-store.port';
import { type SecretGenerator } from '../domain/secret-generator.port';
import {
  type AccessTokenClaims,
  type JsonWebKeySet,
  type SignedToken,
  type TokenSigner,
} from '../domain/token-signer.port';
import { User } from '../domain/user.entity';
import { type UserRepository } from '../domain/user.repository.port';
import { type Email } from '../domain/value-objects/email.vo';
import { type UserId } from '../domain/value-objects/user-id.vo';

/**
 * Unit test for the refresh-grant use-case: rotation (single-use consume),
 * session continuity, and the fail-closed paths (unknown / expired / orphaned).
 */
describe('RefreshTokenUseCase', () => {
  const fixedNow = new Date('2026-06-07T10:00:00.000Z');
  const nowSeconds = Math.floor(fixedNow.getTime() / 1000);
  const clock: Clock = { now: () => fixedNow };

  const policy: TokenIssuancePolicy = {
    issuer: 'http://localhost:3100',
    audience: 'authz-platform',
    accessTokenTtlSeconds: 900,
    refreshTokenTtlSeconds: 2_592_000,
  };

  const USER_ID = '22222222-2222-4222-8222-222222222222';

  function makeUser(active = true): User {
    return User.fromSnapshot({
      id: USER_ID,
      email: 'sam@acme.com',
      passwordHash: 'scrypt$00$ff',
      tenantId: 'acme',
      active,
    });
  }

  function makeSigner(): TokenSigner & { signAccessToken: jest.Mock } {
    const signed: SignedToken = {
      token: 'new.access.jwt',
      issuedAt: nowSeconds,
      expiresAt: nowSeconds + policy.accessTokenTtlSeconds,
    };
    return {
      signAccessToken: jest.fn(() => signed),
      jwks: (): JsonWebKeySet => ({ keys: [] }),
    };
  }

  const secrets: SecretGenerator = {
    refreshToken: () => 'rt_rotated',
    sessionId: () => 'sid_new_should_not_be_used',
  };

  function makeRepo(user: User | null): UserRepository {
    return {
      findByEmail: jest.fn((_e: Email) => Promise.resolve(user)),
      findById: jest.fn((_id: UserId) => Promise.resolve(user)),
    };
  }

  function record(overrides: Partial<RefreshTokenRecord> = {}): RefreshTokenRecord {
    return {
      token: 'rt_old',
      userId: USER_ID,
      tenantId: 'acme',
      sessionId: 'sid_original',
      expiresAt: nowSeconds + 1000,
      ...overrides,
    };
  }

  function build(
    store: RefreshTokenStore,
    repo: UserRepository,
    signer: TokenSigner,
  ): RefreshTokenUseCase {
    const factory = new TokenPairFactory(signer, store, secrets, clock, policy);
    return new RefreshTokenUseCase(store, repo, clock, factory);
  }

  it('rotates a valid token and KEEPS the original session id', async () => {
    const store: RefreshTokenStore & { consume: jest.Mock } = {
      save: jest.fn().mockResolvedValue(undefined),
      consume: jest.fn().mockResolvedValue(record()),
    };
    const signer = makeSigner();
    const useCase = build(store, makeRepo(makeUser()), signer);

    const view = await useCase.execute({ refreshToken: 'rt_old' });

    expect(store.consume).toHaveBeenCalledWith('rt_old');
    expect(view.accessToken).toBe('new.access.jwt');
    expect(view.refreshToken).toBe('rt_rotated');
    // Session id is preserved across rotation.
    expect(view.sid).toBe('sid_original');
    const claims = signer.signAccessToken.mock.calls[0][0] as AccessTokenClaims;
    expect(claims.sid).toBe('sid_original');
  });

  it('rejects an unknown / already-consumed token (rotation replay defense)', async () => {
    const store: RefreshTokenStore = {
      save: jest.fn(),
      consume: jest.fn().mockResolvedValue(null),
    };
    const useCase = build(store, makeRepo(makeUser()), makeSigner());

    await expect(useCase.execute({ refreshToken: 'rt_stolen' })).rejects.toBeInstanceOf(
      InvalidRefreshTokenError,
    );
  });

  it('rejects an expired token', async () => {
    const store: RefreshTokenStore = {
      save: jest.fn(),
      consume: jest.fn().mockResolvedValue(record({ expiresAt: nowSeconds - 1 })),
    };
    const useCase = build(store, makeRepo(makeUser()), makeSigner());

    await expect(useCase.execute({ refreshToken: 'rt_old' })).rejects.toBeInstanceOf(
      InvalidRefreshTokenError,
    );
  });

  it('rejects an orphaned token whose user is gone or disabled', async () => {
    const store: RefreshTokenStore = {
      save: jest.fn(),
      consume: jest.fn().mockResolvedValue(record()),
    };
    const useCase = build(store, makeRepo(null), makeSigner());

    await expect(useCase.execute({ refreshToken: 'rt_old' })).rejects.toBeInstanceOf(
      InvalidRefreshTokenError,
    );
  });
});

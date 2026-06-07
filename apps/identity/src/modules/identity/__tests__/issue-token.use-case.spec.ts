import { type Clock } from '@kernel/core';

import { type TokenIssuancePolicy } from '../application/token-issuance.policy';
import { TokenPairFactory } from '../application/token-pair.factory';
import { IssueTokenUseCase } from '../application/use-cases/issue-token.use-case';
import { InvalidCredentialsError } from '../domain/identity.errors';
import { type PasswordHasher } from '../domain/password-hasher.port';
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
import { PasswordHash } from '../domain/value-objects/password-hash.vo';
import { type UserId } from '../domain/value-objects/user-id.vo';

/**
 * Unit test for the password-grant use-case. Every port (user repo, hasher,
 * signer, refresh store, secret generator, clock, policy) is mocked, so this
 * exercises pure application logic with no NestJS, no crypto, no DB.
 */
describe('IssueTokenUseCase', () => {
  const fixedNow = new Date('2026-06-07T10:00:00.000Z');
  const nowSeconds = Math.floor(fixedNow.getTime() / 1000);
  const clock: Clock = { now: () => fixedNow };

  const policy: TokenIssuancePolicy = {
    issuer: 'http://localhost:3100',
    audience: 'authz-platform',
    accessTokenTtlSeconds: 900,
    refreshTokenTtlSeconds: 2_592_000,
  };

  const USER_ID = '11111111-1111-4111-8111-111111111111';

  function makeUser(active = true): User {
    return User.fromSnapshot({
      id: USER_ID,
      email: 'riya@acme.com',
      passwordHash: 'scrypt$00$ff',
      tenantId: 'acme',
      name: 'Riya',
      active,
    });
  }

  function makeSigner(): TokenSigner & { signAccessToken: jest.Mock } {
    const signed: SignedToken = {
      token: 'header.payload.sig',
      issuedAt: nowSeconds,
      expiresAt: nowSeconds + policy.accessTokenTtlSeconds,
    };
    return {
      signAccessToken: jest.fn((_c: AccessTokenClaims) => signed),
      jwks: (): JsonWebKeySet => ({ keys: [] }),
    };
  }

  function makeHasher(matches: boolean): PasswordHasher {
    return {
      hash: jest.fn(),
      verify: jest.fn().mockResolvedValue(matches),
      dummyHash: jest.fn(() => PasswordHash.fromEncoded('scrypt$00$00')),
    };
  }

  function makeStore(): RefreshTokenStore & { save: jest.Mock } {
    return {
      save: jest.fn().mockResolvedValue(undefined),
      consume: jest.fn().mockResolvedValue(null),
    };
  }

  const secrets: SecretGenerator = {
    refreshToken: () => 'rt_fixed',
    sessionId: () => 'sid_fixed',
  };

  function makeRepo(user: User | null): UserRepository {
    return {
      findByEmail: jest.fn((_e: Email) => Promise.resolve(user)),
      findById: jest.fn((_id: UserId) => Promise.resolve(user)),
    };
  }

  function build(
    repo: UserRepository,
    hasher: PasswordHasher,
    signer: TokenSigner,
    store: RefreshTokenStore,
  ): IssueTokenUseCase {
    const factory = new TokenPairFactory(signer, store, secrets, clock, policy);
    return new IssueTokenUseCase(repo, hasher, factory);
  }

  it('issues a signed access + refresh token pair for valid credentials', async () => {
    const user = makeUser();
    const signer = makeSigner();
    const store = makeStore();
    const useCase = build(makeRepo(user), makeHasher(true), signer, store);

    const view = await useCase.execute({ email: 'riya@acme.com', password: 'Password123!' });

    expect(view.accessToken).toBe('header.payload.sig');
    expect(view.refreshToken).toBe('rt_fixed');
    expect(view.tokenType).toBe('Bearer');
    expect(view.expiresIn).toBe(900);
    expect(view.sub).toBe(USER_ID);
    expect(view.tid).toBe('acme');
    expect(view.sid).toBe('sid_fixed');

    // Claims carry IDENTITY + TENANT only (sub/tid/sid/act), NO roles (D4).
    const claims = signer.signAccessToken.mock.calls[0][0] as AccessTokenClaims;
    expect(claims).toStrictEqual({
      sub: USER_ID,
      tid: 'acme',
      sid: 'sid_fixed',
      act: USER_ID,
      iss: policy.issuer,
      aud: policy.audience,
    });
    expect(claims).not.toHaveProperty('roles');
    expect(claims).not.toHaveProperty('permissions');

    // A refresh-token record was persisted with the correct expiry/binding.
    const saved = store.save.mock.calls[0][0] as RefreshTokenRecord;
    expect(saved).toStrictEqual({
      token: 'rt_fixed',
      userId: USER_ID,
      tenantId: 'acme',
      sessionId: 'sid_fixed',
      expiresAt: nowSeconds + policy.refreshTokenTtlSeconds,
    });
  });

  it('mints the platform-admin scope into the claims for an admin account (DESIGN §6/§7)', async () => {
    const adminUser = User.fromSnapshot({
      id: USER_ID,
      email: 'dev@acme.com',
      passwordHash: 'scrypt$00$ff',
      tenantId: 'acme',
      name: 'Dev (Org Admin)',
      active: true,
      platformAdmin: true,
    });
    const signer = makeSigner();
    const useCase = build(makeRepo(adminUser), makeHasher(true), signer, makeStore());

    await useCase.execute({ email: 'dev@acme.com', password: 'Password123!' });

    const claims = signer.signAccessToken.mock.calls[0][0] as AccessTokenClaims;
    expect(claims.platformAdmin).toBe(true);
  });

  it('rejects a wrong password with InvalidCredentialsError (no token issued)', async () => {
    const signer = makeSigner();
    const store = makeStore();
    const useCase = build(makeRepo(makeUser()), makeHasher(false), signer, store);

    await expect(
      useCase.execute({ email: 'riya@acme.com', password: 'wrong' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(signer.signAccessToken).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });

  it('rejects an unknown user with the SAME generic error (no enumeration)', async () => {
    const hasher = makeHasher(false);
    const useCase = build(makeRepo(null), hasher, makeSigner(), makeStore());

    await expect(
      useCase.execute({ email: 'nobody@acme.com', password: 'whatever' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    // A real verify ran against the dummy hash to keep timing uniform.
    expect(hasher.verify).toHaveBeenCalledTimes(1);
    expect(hasher.dummyHash).toHaveBeenCalledTimes(1);
  });

  it('rejects a disabled account even with the right password', async () => {
    const useCase = build(makeRepo(makeUser(false)), makeHasher(true), makeSigner(), makeStore());

    await expect(
      useCase.execute({ email: 'riya@acme.com', password: 'Password123!' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('rejects a malformed email at the domain boundary', async () => {
    const useCase = build(makeRepo(makeUser()), makeHasher(true), makeSigner(), makeStore());

    await expect(useCase.execute({ email: 'not-an-email', password: 'x' })).rejects.toThrow();
  });
});

import { DEV_INTERNAL_TOKEN_SECRET, loadConfig } from '../config.schema';

/**
 * Locks the fail-closed production guard for the internal-token HMAC secret: a
 * production gateway MUST NOT sign the internal identity token with the committed,
 * repo-known dev secret, or anyone who knows it could mint a valid signed token
 * for any sub/tid and impersonate any principal in any tenant.
 */
describe('gateway config — production internal-token-secret guard', () => {
  const base = {
    IDENTITY_JWKS_URL: 'http://identity:3200/.well-known/jwks.json',
    IDENTITY_URL: 'http://identity:3200',
    AUTHZ_ADMIN_URL: 'http://authz-admin:3000',
    EXPENSE_URL: 'http://expense:3300',
  } as const;

  it('refuses to boot in production with the committed dev secret', () => {
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        INTERNAL_TOKEN_SECRET: DEV_INTERNAL_TOKEN_SECRET,
      }),
    ).toThrow(/INTERNAL_TOKEN_SECRET/);
  });

  it('refuses to boot in production when the secret is unset (defaults to dev secret)', () => {
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: 'production',
      }),
    ).toThrow(/INTERNAL_TOKEN_SECRET/);
  });

  it('boots in production with a distinct internal-token secret', () => {
    const cfg = loadConfig({
      ...base,
      NODE_ENV: 'production',
      INTERNAL_TOKEN_SECRET: 'a-unique-production-secret',
    });
    expect(cfg.INTERNAL_TOKEN_SECRET).toBe('a-unique-production-secret');
  });

  it('allows the dev secret outside production (dev/test convenience)', () => {
    const cfg = loadConfig({
      ...base,
      NODE_ENV: 'development',
      INTERNAL_TOKEN_SECRET: DEV_INTERNAL_TOKEN_SECRET,
    });
    expect(cfg.INTERNAL_TOKEN_SECRET).toBe(DEV_INTERNAL_TOKEN_SECRET);
  });
});

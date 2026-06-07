import { loadConfig } from '../config.schema';

/**
 * Locks the fail-closed production guard for the runtime DB credentials: a
 * production deployment MUST explicitly supply DB_USERNAME/DB_PASSWORD, never
 * silently fall back to the shipped `expense_app` defaults (repo-known creds).
 * Presence is checked against the RAW env so an operator who deliberately sets a
 * value (even one equal to the default) is allowed — only the silent default is
 * rejected, which keeps deliberate test/deploy fixtures valid.
 */
describe('expense config — production DB-credential guard', () => {
  it('refuses to boot in production when DB credentials are unset', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/DB_USERNAME, DB_PASSWORD/);
  });

  it('refuses to boot in production when only the password is unset', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', DB_USERNAME: 'expense_app' })).toThrow(
      /DB_PASSWORD/,
    );
  });

  it('boots in production when both credentials are explicitly provided', () => {
    const cfg = loadConfig({
      NODE_ENV: 'production',
      DB_USERNAME: 'expense_app',
      DB_PASSWORD: 'expense_app',
      // A PEP in production must verify the gateway-signed internal token (DESIGN §7).
      INTERNAL_TOKEN_SECRET: 'prod-internal-secret',
    });
    expect(cfg.DB_USERNAME).toBe('expense_app');
    expect(cfg.DB_PASSWORD).toBe('expense_app');
  });

  it('does not require explicit credentials when DB is disabled in production', () => {
    const cfg = loadConfig({
      NODE_ENV: 'production',
      DB_ENABLED: 'false',
      INTERNAL_TOKEN_SECRET: 'prod-internal-secret',
    });
    expect(cfg.DB_ENABLED).toBe(false);
  });

  it('falls back to defaults outside production (dev convenience)', () => {
    const cfg = loadConfig({ NODE_ENV: 'development' });
    expect(cfg.DB_USERNAME).toBe('expense_app');
    expect(cfg.DB_PASSWORD).toBe('expense_app');
  });
});

/**
 * Locks the fail-closed production guard for internal-token signature
 * verification: a PEP in production MUST set INTERNAL_TOKEN_SECRET so the
 * IdentityContextMiddleware verifies the gateway-signed internal identity token
 * (DESIGN §7). Booting without it would silently fall back to the dev/test
 * placeholder that trusts UNSIGNED identity headers (a confused-deputy hole).
 */
describe('expense config — production internal-token-secret guard', () => {
  it('refuses to boot in production when INTERNAL_TOKEN_SECRET is unset', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        DB_USERNAME: 'expense_app',
        DB_PASSWORD: 'expense_app',
      }),
    ).toThrow(/INTERNAL_TOKEN_SECRET/);
  });

  it('boots in production when INTERNAL_TOKEN_SECRET is provided', () => {
    const cfg = loadConfig({
      NODE_ENV: 'production',
      DB_USERNAME: 'expense_app',
      DB_PASSWORD: 'expense_app',
      INTERNAL_TOKEN_SECRET: 'prod-internal-secret',
    });
    expect(cfg.INTERNAL_TOKEN_SECRET).toBe('prod-internal-secret');
  });

  it('does NOT require the secret outside production (dev/test placeholder mode)', () => {
    const cfg = loadConfig({ NODE_ENV: 'development' });
    expect(cfg.INTERNAL_TOKEN_SECRET).toBe('');
  });
});

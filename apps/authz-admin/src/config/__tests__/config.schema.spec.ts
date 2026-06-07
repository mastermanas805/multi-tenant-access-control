import { loadConfig } from '../config.schema';

/**
 * Locks the fail-closed production guard for the runtime DB credentials: a
 * production deployment MUST explicitly supply DB_USERNAME/DB_PASSWORD, never
 * silently fall back to the shipped `authz_app` defaults (repo-known creds).
 * Presence is checked against the RAW env so an operator who deliberately sets a
 * value (even one equal to the default) is allowed — only the silent default is
 * rejected, which keeps deliberate test/deploy fixtures valid.
 */
describe('authz-admin config — production DB-credential guard', () => {
  it('refuses to boot in production when DB credentials are unset', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/DB_USERNAME, DB_PASSWORD/);
  });

  it('refuses to boot in production when only the password is unset', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', DB_USERNAME: 'authz_app' })).toThrow(
      /DB_PASSWORD/,
    );
  });

  it('boots in production when both credentials and the internal-token secret are provided', () => {
    const cfg = loadConfig({
      NODE_ENV: 'production',
      DB_USERNAME: 'authz_app',
      DB_PASSWORD: 'authz_app',
      INTERNAL_TOKEN_SECRET: 'prod-internal-secret',
    });
    expect(cfg.DB_USERNAME).toBe('authz_app');
    expect(cfg.DB_PASSWORD).toBe('authz_app');
    expect(cfg.INTERNAL_TOKEN_SECRET).toBe('prod-internal-secret');
  });

  it('does not require explicit credentials when DB is disabled in production (but still needs the token secret)', () => {
    const cfg = loadConfig({
      NODE_ENV: 'production',
      DB_ENABLED: 'false',
      INTERNAL_TOKEN_SECRET: 'prod-internal-secret',
    });
    expect(cfg.DB_ENABLED).toBe(false);
  });

  it('falls back to defaults outside production (dev convenience)', () => {
    const cfg = loadConfig({ NODE_ENV: 'development' });
    expect(cfg.DB_USERNAME).toBe('authz_app');
    expect(cfg.DB_PASSWORD).toBe('authz_app');
  });
});

/**
 * Locks the fail-closed production guard for the internal identity token (DESIGN
 * §7): the PAP — the IAM control plane — MUST verify the gateway-signed token in
 * production, so INTERNAL_TOKEN_SECRET must be set. Without it the middleware would
 * trust unsigned identity headers, letting a co-located/SSRF/east-west caller forge
 * an arbitrary tenant + platform-admin context against the whole IAM plane.
 */
describe('authz-admin config — production internal-token-secret guard', () => {
  const prodDb = { DB_USERNAME: 'authz_app', DB_PASSWORD: 'authz_app' } as const;

  it('refuses to boot in production when INTERNAL_TOKEN_SECRET is unset', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', ...prodDb })).toThrow(
      /INTERNAL_TOKEN_SECRET/,
    );
  });

  it('refuses to boot in production when INTERNAL_TOKEN_SECRET is empty', () => {
    expect(() =>
      loadConfig({ NODE_ENV: 'production', ...prodDb, INTERNAL_TOKEN_SECRET: '' }),
    ).toThrow(/INTERNAL_TOKEN_SECRET/);
  });

  it('boots in production when INTERNAL_TOKEN_SECRET is provided', () => {
    const cfg = loadConfig({
      NODE_ENV: 'production',
      ...prodDb,
      INTERNAL_TOKEN_SECRET: 'prod-internal-secret',
    });
    expect(cfg.INTERNAL_TOKEN_SECRET).toBe('prod-internal-secret');
  });

  it('does not require the secret outside production (dev/test placeholder path)', () => {
    const cfg = loadConfig({ NODE_ENV: 'development' });
    expect(cfg.INTERNAL_TOKEN_SECRET).toBe('');
  });
});

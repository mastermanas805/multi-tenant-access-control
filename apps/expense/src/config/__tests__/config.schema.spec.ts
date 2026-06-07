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
    });
    expect(cfg.DB_USERNAME).toBe('expense_app');
    expect(cfg.DB_PASSWORD).toBe('expense_app');
  });

  it('does not require explicit credentials when DB is disabled in production', () => {
    const cfg = loadConfig({ NODE_ENV: 'production', DB_ENABLED: 'false' });
    expect(cfg.DB_ENABLED).toBe(false);
  });

  it('falls back to defaults outside production (dev convenience)', () => {
    const cfg = loadConfig({ NODE_ENV: 'development' });
    expect(cfg.DB_USERNAME).toBe('expense_app');
    expect(cfg.DB_PASSWORD).toBe('expense_app');
  });
});

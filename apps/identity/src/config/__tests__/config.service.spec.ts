import { ConfigService } from '../config.service';

/**
 * Locks the fail-closed production guard for the RS256 signing keypair: the
 * identity service signs every user access token, and the committed dev keypair
 * (apps/identity/keys) is published in the repo. A production deploy that forgets
 * to inject its own keys MUST refuse to boot rather than sign tokens anyone with
 * the repo could forge. The dev fallback survives for development/test only.
 */
describe('identity ConfigService — production signing-key guard', () => {
  const KEY_ENV_VARS = [
    'JWT_PRIVATE_KEY',
    'JWT_PRIVATE_KEY_PATH',
    'JWT_PUBLIC_KEY',
    'JWT_PUBLIC_KEY_PATH',
  ] as const;

  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {
      NODE_ENV: process.env.NODE_ENV,
      ...Object.fromEntries(KEY_ENV_VARS.map((k) => [k, process.env[k]])),
    };
    for (const k of KEY_ENV_VARS) {
      Reflect.deleteProperty(process.env, k);
    }
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) {
        Reflect.deleteProperty(process.env, k);
      } else {
        process.env[k] = v;
      }
    }
  });

  it('refuses to boot in production without an injected keypair', () => {
    process.env.NODE_ENV = 'production';
    expect(() => new ConfigService()).toThrow(/production must supply its own RS256 keypair/);
  });

  it('refuses to boot in production with only a private key (public missing)', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_PRIVATE_KEY_PATH = `${__dirname}/../../../keys/dev-private.pem`;
    expect(() => new ConfigService()).toThrow(/JWT_PUBLIC_KEY/);
  });

  it('boots in production when both keys are injected via path', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_PRIVATE_KEY_PATH = `${__dirname}/../../../keys/dev-private.pem`;
    process.env.JWT_PUBLIC_KEY_PATH = `${__dirname}/../../../keys/dev-public.pem`;
    const svc = new ConfigService();
    expect(svc.jwtPrivateKeyPem).toContain('PRIVATE KEY');
    expect(svc.jwtPublicKeyPem).toContain('PUBLIC KEY');
  });

  it('falls back to the committed dev keypair outside production', () => {
    process.env.NODE_ENV = 'test';
    const svc = new ConfigService();
    expect(svc.jwtPrivateKeyPem).toContain('PRIVATE KEY');
    expect(svc.jwtPublicKeyPem).toContain('PUBLIC KEY');
  });
});

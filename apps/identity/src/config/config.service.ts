import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Injectable } from '@nestjs/common';

import { type AppConfig, loadConfig } from './config.schema';

/** A seeded demo user, parsed from SEED_USERS (or the built-in defaults). */
export interface SeedUserConfig {
  id: string;
  email: string;
  password: string;
  tenantId: string;
  name?: string;
}

/**
 * The default DESIGN demo users (riya/sam/dev @acme.com). Used when SEED_USERS
 * is not set. Passwords are DEV DEFAULTS — never ship these to production.
 */
const DEFAULT_SEED_USERS: readonly SeedUserConfig[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'riya@acme.com',
    password: 'Password123!',
    tenantId: 'acme',
    name: 'Riya (Finance Manager)',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    email: 'sam@acme.com',
    password: 'Password123!',
    tenantId: 'acme',
    name: 'Sam (Employee)',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    email: 'dev@acme.com',
    password: 'Password123!',
    tenantId: 'acme',
    name: 'Dev (Engineer)',
  },
];

/**
 * The dir holding the COMMITTED DEV keypair (apps/identity/keys). Resolved
 * relative to the compiled file so it works from both `src` (ts-node) and
 * `dist` (node) — both sit two levels under the app root.
 */
const DEV_KEYS_DIR = join(__dirname, '..', '..', 'keys');

/** DI token-free typed config. Inject `ConfigService` and read `.values`. */
@Injectable()
export class ConfigService {
  public readonly values: AppConfig;

  private readonly privateKeyPem: string;
  private readonly publicKeyPem: string;
  private readonly seedUsers: readonly SeedUserConfig[];

  constructor() {
    this.values = loadConfig();
    this.assertProductionSigningKeys();
    this.privateKeyPem = this.resolvePrivateKey();
    this.publicKeyPem = this.resolvePublicKey();
    this.seedUsers = this.resolveSeedUsers();
  }

  public get isProduction(): boolean {
    return this.values.NODE_ENV === 'production';
  }

  public get isTest(): boolean {
    return this.values.NODE_ENV === 'test';
  }

  /** The RS256 private signing key (PKCS#8 PEM). */
  public get jwtPrivateKeyPem(): string {
    return this.privateKeyPem;
  }

  /** The RS256 public verification key (SPKI PEM) — published via JWKS. */
  public get jwtPublicKeyPem(): string {
    return this.publicKeyPem;
  }

  /** The seeded demo users (defaults to the DESIGN demo set). */
  public get seedUserConfigs(): readonly SeedUserConfig[] {
    return this.seedUsers;
  }

  // --- Resolution helpers ----------------------------------------------------

  /**
   * Fail-closed production guard (mirrors the RLS superuser boot assertion in the
   * data-stores): the identity service signs every user access token with the
   * RS256 private key. The committed dev keypair (apps/identity/keys) is published
   * in the repo, so signing prod tokens with it would let anyone holding the repo
   * forge a valid JWT for any user/tenant. REFUSES TO BOOT if production does not
   * inject its OWN private+public key (via JWT_PRIVATE_KEY/_PATH and
   * JWT_PUBLIC_KEY/_PATH). The dev fallback is kept ONLY for development/test.
   */
  private assertProductionSigningKeys(): void {
    if (!this.isProduction) {
      return;
    }
    const { JWT_PRIVATE_KEY, JWT_PRIVATE_KEY_PATH, JWT_PUBLIC_KEY, JWT_PUBLIC_KEY_PATH } =
      this.values;
    const hasPrivate = Boolean(JWT_PRIVATE_KEY ?? JWT_PRIVATE_KEY_PATH);
    const hasPublic = Boolean(JWT_PUBLIC_KEY ?? JWT_PUBLIC_KEY_PATH);
    if (hasPrivate && hasPublic) {
      return;
    }
    const missing = [
      ...(hasPrivate ? [] : ['JWT_PRIVATE_KEY or JWT_PRIVATE_KEY_PATH']),
      ...(hasPublic ? [] : ['JWT_PUBLIC_KEY or JWT_PUBLIC_KEY_PATH']),
    ].join(', ');
    throw new Error(
      `Signing-key safety check failed: production must supply its own RS256 keypair ` +
        `(missing ${missing}). Refusing to boot with the committed dev keypair ` +
        `(apps/identity/keys), which is published in the repo and would let anyone ` +
        `forge valid JWTs for any user/tenant.`,
    );
  }

  private resolvePrivateKey(): string {
    const { JWT_PRIVATE_KEY, JWT_PRIVATE_KEY_PATH } = this.values;
    if (JWT_PRIVATE_KEY) {
      return normalizePem(JWT_PRIVATE_KEY);
    }
    if (JWT_PRIVATE_KEY_PATH) {
      return readFileSync(JWT_PRIVATE_KEY_PATH, 'utf8');
    }
    // Dev default (committed): apps/identity/keys/dev-private.pem.
    return readFileSync(join(DEV_KEYS_DIR, 'dev-private.pem'), 'utf8');
  }

  private resolvePublicKey(): string {
    const { JWT_PUBLIC_KEY, JWT_PUBLIC_KEY_PATH } = this.values;
    if (JWT_PUBLIC_KEY) {
      return normalizePem(JWT_PUBLIC_KEY);
    }
    if (JWT_PUBLIC_KEY_PATH) {
      return readFileSync(JWT_PUBLIC_KEY_PATH, 'utf8');
    }
    return readFileSync(join(DEV_KEYS_DIR, 'dev-public.pem'), 'utf8');
  }

  private resolveSeedUsers(): readonly SeedUserConfig[] {
    const raw = this.values.SEED_USERS;
    if (!raw) {
      return DEFAULT_SEED_USERS;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error('SEED_USERS must be a JSON array of users');
    }
    return parsed.map((entry, index) => toSeedUser(entry, index));
  }
}

/** Restores PEM newlines when a key is provided as a single-line \n-escaped env value. */
function normalizePem(value: string): string {
  return value.includes('\\n') ? value.replace(/\\n/g, '\n') : value;
}

function toSeedUser(entry: unknown, index: number): SeedUserConfig {
  if (typeof entry !== 'object' || entry === null) {
    throw new Error(`SEED_USERS[${String(index)}] must be an object`);
  }
  const record = entry as Record<string, unknown>;
  const { id, email, password, tenantId, name } = record;
  if (
    typeof id !== 'string' ||
    typeof email !== 'string' ||
    typeof password !== 'string' ||
    typeof tenantId !== 'string'
  ) {
    throw new Error(`SEED_USERS[${String(index)}] requires string id, email, password, tenantId`);
  }
  return {
    id,
    email,
    password,
    tenantId,
    ...(typeof name === 'string' ? { name } : {}),
  };
}

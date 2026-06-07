import { z } from 'zod';

/**
 * Typed, validated configuration. Parsed once at boot from process.env; an
 * invalid environment fails fast (no half-configured service in production).
 *
 * The identity service is config-seeded (no Postgres): demo users and the RS256
 * signing keypair come from the environment. The dev keypair under `keys/` is a
 * COMMITTED DEV DEFAULT only — production MUST inject its own keys (DESIGN §7).
 */
export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3100),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // --- OIDC issuer identity ---------------------------------------------------
  /** `iss` claim and OIDC issuer URL. Also the audience the gateway verifies. */
  IDENTITY_ISSUER: z.string().default('http://localhost:3100'),
  /** `aud` claim — the API audience the access token is minted for. */
  IDENTITY_AUDIENCE: z.string().default('authz-platform'),

  // --- RS256 signing keypair --------------------------------------------------
  /**
   * The active signing key id, surfaced in the JWT header `kid` and the JWKS
   * `kid`. Rotating keys = mint under a new kid while still publishing the old
   * public key in the JWKS until all tokens signed with it have expired.
   */
  JWT_SIGNING_KID: z.string().default('dev-rsa-2026'),
  /**
   * RS256 private key (PKCS#8 PEM). Either the literal PEM (newlines may be
   * escaped as \n) OR a path to a .pem file via JWT_PRIVATE_KEY_PATH. Exactly one
   * source must be present (asserted in the ConfigService).
   */
  JWT_PRIVATE_KEY: z.string().optional(),
  JWT_PRIVATE_KEY_PATH: z.string().optional(),
  /** RS256 public key (SPKI PEM) or a path via JWT_PUBLIC_KEY_PATH. */
  JWT_PUBLIC_KEY: z.string().optional(),
  JWT_PUBLIC_KEY_PATH: z.string().optional(),

  // --- Token lifetimes --------------------------------------------------------
  /** Access-token lifetime in seconds (~15m by default, DESIGN §5). */
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  /** Refresh-token lifetime in seconds (~30d by default). */
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),

  // --- Seed users -------------------------------------------------------------
  /**
   * JSON array of seeded demo users. Defaults to the three DESIGN demo users
   * (riya/sam/dev @acme.com). Each: { id, email, password, tenantId, name? }.
   * Passwords are plaintext HERE (a dev seed) and hashed in-memory at boot.
   * In production this would be a user store, never plaintext config.
   */
  SEED_USERS: z.string().optional(),
});

export type AppConfig = z.infer<typeof configSchema>;

/** Validates raw env into a typed AppConfig. Throws on the first error. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

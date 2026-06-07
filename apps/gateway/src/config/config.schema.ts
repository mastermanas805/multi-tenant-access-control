import { z } from 'zod';

const booleanFromEnv = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : v.toLowerCase() === 'true'));

/**
 * Typed, validated configuration. Parsed once at boot from process.env; an
 * invalid environment fails fast (no half-configured service in production).
 *
 * The gateway is the authN edge (DESIGN §4.1, §4.3, §4.4): it is stateless and
 * DB-free. It validates the end-user JWT against the Identity JWKS, rate-limits,
 * mints a SIGNED INTERNAL identity token, and routes to the downstream services
 * over the mesh. All upstream targets and the verification/minting parameters are
 * environment-driven — nothing is hardcoded.
 */
export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // --- Inbound user-JWT verification (DESIGN §4.3 step 1, §5) ----------------
  /**
   * Where to fetch the Identity service's public JWKS for RS256 verification.
   * Defaults to the identity service's well-known path in the compose topology.
   */
  IDENTITY_JWKS_URL: z.string().url().default('http://identity:3200/.well-known/jwks.json'),
  /**
   * Expected `iss` claim. Empty disables the issuer check (dev convenience); a
   * production deployment SHOULD set it so a token from another issuer is
   * rejected even if the JWKS is shared.
   */
  IDENTITY_ISSUER: z.string().default('http://localhost:3200'),
  /** Expected `aud` claim — the API audience the access token is minted for. */
  IDENTITY_AUDIENCE: z.string().default('authz-platform'),
  /** Seconds to cache a fetched JWKS before re-fetching (keys rotate slowly). */
  JWKS_CACHE_TTL_SECONDS: z.coerce.number().int().nonnegative().default(300),
  /** Clock-skew tolerance (seconds) applied to `exp`/`nbf`/`iat` checks. */
  JWT_CLOCK_TOLERANCE_SECONDS: z.coerce.number().int().nonnegative().default(60),

  // --- Outbound signed internal identity token (DESIGN §5, §7) --------------
  /**
   * Symmetric key the gateway signs the internal identity token with (HS256).
   * The reference impl uses a shared secret; in production this is an asymmetric
   * key the downstream PEPs verify against the gateway's JWKS (token-exchange,
   * RFC 8693). Defaults to a DEV value — production MUST override it (DESIGN §7).
   */
  INTERNAL_TOKEN_SECRET: z.string().min(1).default('dev-internal-token-secret-change-me'),
  /** Key id stamped into the internal token header (`kid`) for rotation. */
  INTERNAL_TOKEN_KID: z.string().default('gw-internal-2026'),
  /** `iss` claim of the minted internal token (the gateway's own identity). */
  INTERNAL_TOKEN_ISSUER: z.string().default('api-gateway'),
  /** Internal token lifetime in seconds (short — re-minted per request). */
  INTERNAL_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(120),

  // --- Upstream routing targets (DESIGN §4.1 routing) -----------------------
  /** Identity service base URL — receives /auth/* (and is the JWKS source). */
  IDENTITY_URL: z.string().url().default('http://identity:3200'),
  /** Authz-admin (PAP) base URL — receives admin/IAM surfaces. */
  AUTHZ_ADMIN_URL: z.string().url().default('http://authz-admin:3000'),
  /** Expense service base URL — receives /v1/expenses*. */
  EXPENSE_URL: z.string().url().default('http://expense:3300'),
  /** Upstream request timeout in milliseconds (fail-fast, DESIGN §9). */
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  // --- Rate limiting (DESIGN §4.4, §10 — edge DoS protection) ----------------
  /** Enable the fixed-window per-client rate limiter. */
  RATE_LIMIT_ENABLED: booleanFromEnv.default(true),
  /** Window length in milliseconds. */
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  /** Max requests per client per window. */
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
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

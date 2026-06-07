import { z } from 'zod';

/**
 * Typed, validated configuration. Parsed once at boot from process.env; an
 * invalid environment fails fast (no half-configured service in production).
 */
const booleanFromEnv = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : v.toLowerCase() === 'true'));

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DB_ENABLED: booleanFromEnv.default(true),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  // The long-running API connects as the UNPRIVILEGED `expense_app` role
  // (NOSUPERUSER NOBYPASSRLS) so FORCE ROW LEVEL SECURITY is actually enforced.
  // The privileged bootstrap superuser is used ONLY for migrations/seed — override
  // DB_USERNAME/DB_PASSWORD for those commands. A startup assertion (see
  // data-source.ts) refuses to boot if the runtime role is a superuser or has
  // BYPASSRLS (fail-closed).
  DB_USERNAME: z.string().default('expense_app'),
  DB_PASSWORD: z.string().default('expense_app'),
  DB_DATABASE: z.string().default('expense'),
  DB_SYNCHRONIZE: booleanFromEnv.default(false),

  // --- PEP wiring (DESIGN §4.4) — where the PDP, PAP and Audit live ---
  // Cerbos PDP gRPC endpoint. The PEP's CerbosPdpClient connects here; in the
  // compose topology this is the co-located cerbos service `cerbos:3593`.
  CERBOS_URL: z.string().default('localhost:3593'),
  // PAP base URL — the PIP resolves the principal's effective roles/attrs from
  // GET {PAP_URL}/v1/principals/:id/effective (DESIGN §3.5).
  PAP_URL: z.string().default('http://localhost:3000'),
  // Audit service base URL — the AuditSink posts each decision record (allow AND
  // deny) here (DESIGN §8.7, FR-9).
  AUDIT_URL: z.string().default('http://localhost:3100'),
  // Per-request PIP fetch timeout (ms). Bounds a hung PAP so it cannot stall the
  // PEP or pin the RLS-scoped Postgres transaction — fail-closed (DESIGN §9 D8).
  PIP_TIMEOUT_MS: z.coerce.number().int().positive().default(2000),

  // --- Internal identity token verification (DESIGN §5, §7) ---
  // The shared secret the gateway signs the internal identity token's HS256 JWS
  // with (the gateway's INTERNAL_TOKEN_SECRET). When set, the PEP's
  // IdentityContextMiddleware VERIFIES x-internal-identity-signature (iss + exp)
  // and rejects (401) a missing/invalid signature — the production path. When
  // empty (the default), the middleware runs the documented DEV/TEST placeholder
  // that only base64url-decodes the claims, so the unit/e2e/integration suites
  // (which inject the principal context without a real gateway hop) still pass.
  // A boot guard below refuses to start in production with verification disabled.
  INTERNAL_TOKEN_SECRET: z.string().default(''),
  // Expected `iss` of the signed internal token — the gateway's INTERNAL_TOKEN_ISSUER.
  INTERNAL_TOKEN_ISSUER: z.string().default('api-gateway'),
  // Clock-skew tolerance (seconds) for the internal token's `exp` check.
  INTERNAL_TOKEN_CLOCK_TOLERANCE_SECONDS: z.coerce.number().int().nonnegative().default(60),
});

export type AppConfig = z.infer<typeof configSchema>;

/**
 * Validates raw env into a typed AppConfig. Throws on the first error.
 *
 * Fail-closed production guard (mirrors the RLS superuser boot assertion in
 * data-source.ts): a production deployment MUST explicitly supply the runtime DB
 * credentials. If DB_USERNAME/DB_PASSWORD are unset in production the schema
 * would silently fall back to the shipped `expense_app`/`expense_app` defaults,
 * so a prod instance that forgets to inject credentials would start with
 * repo-known passwords. Refuse to boot rather than ship with default creds.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  assertProductionDbCredentials(parsed.data, env);
  assertProductionInternalTokenSecret(parsed.data);
  return parsed.data;
}

/**
 * Refuses to boot when NODE_ENV=production and INTERNAL_TOKEN_SECRET is unset, so
 * the PEP's IdentityContextMiddleware would fall back to the DEV/TEST placeholder
 * that trusts an UNSIGNED `x-internal-identity` header. In production that is a
 * confused-deputy hole: any caller that can reach the PEP could assert an arbitrary
 * principal/tenant. Fail closed and demand the gateway's signing secret (DESIGN §7).
 */
function assertProductionInternalTokenSecret(config: AppConfig): void {
  if (config.NODE_ENV !== 'production') {
    return;
  }
  if (config.INTERNAL_TOKEN_SECRET.length === 0) {
    throw new Error(
      'Invalid environment configuration:\n  - INTERNAL_TOKEN_SECRET: ' +
        'must be set in production so the PEP verifies the gateway-signed internal ' +
        'identity token (refusing to boot with internal-token signature verification ' +
        'disabled, which would trust unsigned identity headers). Set it to the ' +
        "gateway's INTERNAL_TOKEN_SECRET.",
    );
  }
}

/**
 * Refuses to boot when NODE_ENV=production and DB is enabled but the runtime DB
 * credentials were NOT explicitly provided (so the shipped defaults would apply).
 * Presence is checked against the RAW env so an operator who deliberately sets the
 * value (even to the same string) is allowed — only the silent default is rejected.
 */
function assertProductionDbCredentials(config: AppConfig, env: NodeJS.ProcessEnv): void {
  if (config.NODE_ENV !== 'production' || !config.DB_ENABLED) {
    return;
  }
  const missing = (['DB_USERNAME', 'DB_PASSWORD'] as const).filter(
    (key) => env[key] === undefined || env[key] === '',
  );
  if (missing.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n  - ${missing.join(', ')}: ` +
        'must be set explicitly in production (refusing to boot with the shipped ' +
        'default DB credentials). Set DB_USERNAME/DB_PASSWORD to the unprivileged ' +
        'runtime role provisioned by the migration.',
    );
  }
}

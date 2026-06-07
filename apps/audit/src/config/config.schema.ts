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
  PORT: z.coerce.number().int().positive().default(3100),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DB_ENABLED: booleanFromEnv.default(true),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  // The audit log is the compliance system of record. It lives in its OWN
  // database (DESIGN §8.7 / App. C — "Never in the OLTP DB"), written ONLY by
  // this service appending to a hash chain. Unlike the OLTP services there is no
  // per-tenant RLS runtime role: the audit table is append-only and not exposed
  // to tenant-scoped query runners, so a single owning role is correct here.
  DB_USERNAME: z.string().default('authz'),
  DB_PASSWORD: z.string().default('authz'),
  DB_DATABASE: z.string().default('audit'),
  DB_SYNCHRONIZE: booleanFromEnv.default(false),

  // --- Internal identity token verification (DESIGN §5, §7) ---
  // The shared secret the gateway signs the internal identity token's HS256 JWS
  // with (the gateway's INTERNAL_TOKEN_SECRET). The audit READ endpoints mount the
  // reusable PEP's IdentityContextMiddleware, which VERIFIES
  // x-internal-identity-signature (iss + exp); the decision-log read is then scoped
  // to the caller's VERIFIED tenant (`tid`), so a client cannot read another
  // tenant's decision log via a `?tenantId=` filter (DESIGN §6/§7). A verified
  // platform-admin may read cross-tenant. When empty (the default) the middleware
  // runs the DEV/TEST placeholder decode, so the e2e suite passes without a real
  // gateway hop. A boot guard below refuses to start in production with verification
  // disabled. (The append-only INGEST endpoint is a separate trust boundary —
  // mTLS/SPIFFE in production — and is NOT gated by this middleware, DESIGN §10.)
  INTERNAL_TOKEN_SECRET: z.string().default(''),
  // Expected `iss` of the signed internal token — the gateway's INTERNAL_TOKEN_ISSUER.
  INTERNAL_TOKEN_ISSUER: z.string().default('api-gateway'),
  // Clock-skew tolerance (seconds) for the internal token's `exp` check.
  INTERNAL_TOKEN_CLOCK_TOLERANCE_SECONDS: z.coerce.number().int().nonnegative().default(60),
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
  assertProductionInternalTokenSecret(parsed.data);
  return parsed.data;
}

/**
 * Refuses to boot when NODE_ENV=production and INTERNAL_TOKEN_SECRET is unset, so
 * the audit READ endpoints' IdentityContextMiddleware would fall back to the
 * DEV/TEST placeholder that trusts an UNSIGNED x-internal-identity header. That
 * would let a caller forge a tenant context and read another tenant's entire
 * decision log (principals, actions, allow/deny + reasons, decisionIds). Fail
 * closed and demand the gateway's signing secret (DESIGN §7). Mirrors the Expense
 * PEP and the PAP.
 */
function assertProductionInternalTokenSecret(config: AppConfig): void {
  if (config.NODE_ENV !== 'production') {
    return;
  }
  if (config.INTERNAL_TOKEN_SECRET.length === 0) {
    throw new Error(
      'Invalid environment configuration:\n  - INTERNAL_TOKEN_SECRET: ' +
        'must be set in production so the audit read endpoints verify the ' +
        'gateway-signed internal identity token and scope the decision log to the ' +
        "caller's verified tenant (refusing to boot with verification disabled, " +
        "which would allow cross-tenant log reads). Set it to the gateway's " +
        'INTERNAL_TOKEN_SECRET.',
    );
  }
}

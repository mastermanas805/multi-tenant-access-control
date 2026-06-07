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
  // The long-running API connects as the UNPRIVILEGED `authz_app` role
  // (NOSUPERUSER NOBYPASSRLS) so FORCE ROW LEVEL SECURITY is actually enforced.
  // The privileged bootstrap superuser (`authz`) is used ONLY for
  // migrations/seed — override DB_USERNAME/DB_PASSWORD for those commands. A
  // startup assertion (see data-source.ts) refuses to boot if the runtime role
  // is a superuser or has BYPASSRLS (fail-closed).
  DB_USERNAME: z.string().default('authz_app'),
  DB_PASSWORD: z.string().default('authz_app'),
  DB_DATABASE: z.string().default('authz_admin'),
  DB_SYNCHRONIZE: booleanFromEnv.default(false),

  // --- Cerbos PDP publishing (DESIGN §3.4, §8.7, FR-8) ---
  // The shared disk-storage directory the Cerbos PDP watches
  // (`watchForChanges: true`). When the PAP publishes/activates/rolls back a
  // policy it compiles the DB jsonb into a Cerbos resourcePolicy YAML and writes
  // it HERE; Cerbos hot-reloads it within seconds — NOTHING is hardcoded. In the
  // compose topology this is the bind-mount `./deploy/cerbos/policies`.
  CERBOS_POLICY_DIR: z.string().default('deploy/cerbos/policies'),
  // Integration toggle: when false the publisher is a no-op (the use-cases run
  // without touching the filesystem). Unit/e2e suites set this false so they need
  // no disk; a live deployment leaves it true so publishing is effective.
  CERBOS_PUBLISH_ENABLED: booleanFromEnv.default(true),
  // gRPC endpoint of the Cerbos PDP — surfaced for symmetry with the PEP config
  // and for an operator health/diagnostics view (DESIGN §8.2).
  CERBOS_URL: z.string().default('localhost:3593'),
});

export type AppConfig = z.infer<typeof configSchema>;

/**
 * Validates raw env into a typed AppConfig. Throws on the first error.
 *
 * Fail-closed production guard (mirrors the RLS superuser boot assertion in
 * data-source.ts): a production deployment MUST explicitly supply the runtime DB
 * credentials. If DB_USERNAME/DB_PASSWORD are unset in production the schema
 * would silently fall back to the shipped `authz_app`/`authz_app` defaults, so a
 * prod instance that forgets to inject credentials would start with repo-known
 * passwords. Refuse to boot rather than ship with default creds.
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
  return parsed.data;
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

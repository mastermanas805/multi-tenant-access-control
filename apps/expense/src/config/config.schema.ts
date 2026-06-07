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

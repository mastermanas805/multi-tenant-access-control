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

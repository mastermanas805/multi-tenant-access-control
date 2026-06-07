import 'reflect-metadata';

import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { join } from 'node:path';

import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';

import { AppModule as IdentityAppModule } from '../../../../apps/identity/src/app.module';
import { GlobalExceptionFilter as IdentityFilter } from '../../../../apps/identity/src/shared/presentation/global-exception.filter';
import { AppModule as GatewayAppModule } from '../../../../apps/gateway/src/app.module';
import { GlobalExceptionFilter as GatewayFilter } from '../../../../apps/gateway/src/shared/presentation/global-exception.filter';

import { TENANT_ACME } from './seed-data';

/** A single demo user the gateway suite logs in as (real RS256 JWT from identity). */
export const GATEWAY_DEMO_USER = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'riya@acme.com',
  password: 'Password123!',
  tenantId: TENANT_ACME,
} as const;

const ISSUER = 'http://localhost:3200';
const AUDIENCE = 'authz-platform';

// The committed dev keypair. Identity now refuses to boot under NODE_ENV=production
// without an explicitly injected keypair (fail-closed against signing prod tokens
// with the repo-known dev key); this suite mirrors a prod deploy that injects keys
// by pointing at the dev keypair on disk, so the JWTs are still real RS256 tokens.
const IDENTITY_KEYS_DIR = join(__dirname, '..', '..', '..', '..', 'apps', 'identity', 'keys');
const DEV_PRIVATE_KEY_PATH = join(IDENTITY_KEYS_DIR, 'dev-private.pem');
const DEV_PUBLIC_KEY_PATH = join(IDENTITY_KEYS_DIR, 'dev-public.pem');

/** What the echo upstream captured from the gateway's forwarded request. */
export interface EchoCapture {
  readonly path: string;
  readonly headers: Record<string, string | string[] | undefined>;
}

export interface GatewayStack {
  readonly gatewayUrl: string;
  readonly identityUrl: string;
  /** The headers the echo upstream last received from the gateway. */
  lastEcho(): EchoCapture | null;
  stop(): Promise<void>;
}

function withEnv(overrides: Record<string, string>): () => void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, key);
      } else {
        process.env[key] = value;
      }
    }
  };
}

async function bootApp(
  module: unknown,
  filterToken: unknown,
  rawBody: boolean,
): Promise<{ app: NestExpressApplication; url: string }> {
  const app = await NestFactory.create<NestExpressApplication>(
    module as Parameters<typeof NestFactory.create>[0],
    { logger: ['error', 'warn'], rawBody },
  );
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(app.get(filterToken as never));
  await app.listen(0);
  const address = app.getHttpServer().address() as AddressInfo;
  return { app, url: `http://127.0.0.1:${String(address.port)}` };
}

/**
 * Boots the gateway authN edge + the real Identity IdP + a tiny echo upstream
 * (standing in for the Expense PEP) so the gateway suite can assert the EDGE
 * responsibilities precisely (DESIGN §4.3, §7):
 *   - a real RS256 JWT issued by Identity is verified against its JWKS;
 *   - an authenticated forward injects the SERVER-DERIVED identity headers;
 *   - client-spoofed x-tenant-id / x-internal-identity are STRIPPED, not trusted.
 *
 * No DB/Cerbos needed — the gateway is stateless. The echo upstream captures the
 * forwarded headers so the confused-deputy defense is directly observable.
 */
export async function startGatewayStack(): Promise<GatewayStack> {
  let lastEcho: EchoCapture | null = null;
  const echo: Server = createServer((req, res) => {
    lastEcho = { path: req.url ?? '', headers: req.headers };
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, seenHeaders: req.headers }));
  });
  await new Promise<void>((resolve) => echo.listen(0, '127.0.0.1', resolve));
  const echoPort = (echo.address() as AddressInfo).port;
  const echoUrl = `http://127.0.0.1:${String(echoPort)}`;

  // Identity: issue tokens for the demo user under the Acme tenant UUID so `tid`
  // is a valid UUID the downstream PEPs accept (DESIGN §6).
  const restoreIdentityEnv = withEnv({
    NODE_ENV: 'production',
    PORT: '4000',
    LOG_LEVEL: 'error',
    IDENTITY_ISSUER: ISSUER,
    IDENTITY_AUDIENCE: AUDIENCE,
    // Production identity refuses the committed dev fallback; inject the keypair
    // explicitly (here the dev keys on disk) the way a real prod deploy would.
    JWT_PRIVATE_KEY_PATH: DEV_PRIVATE_KEY_PATH,
    JWT_PUBLIC_KEY_PATH: DEV_PUBLIC_KEY_PATH,
    ACCESS_TOKEN_TTL_SECONDS: '900',
    REFRESH_TOKEN_TTL_SECONDS: '2592000',
    SEED_USERS: JSON.stringify([
      {
        id: GATEWAY_DEMO_USER.id,
        email: GATEWAY_DEMO_USER.email,
        password: GATEWAY_DEMO_USER.password,
        tenantId: GATEWAY_DEMO_USER.tenantId,
        name: 'Riya (Finance Manager)',
      },
    ]),
  });
  const identity = await bootApp(IdentityAppModule, IdentityFilter, false);
  restoreIdentityEnv();

  // Gateway: verify against the identity JWKS; route /v1/expenses* -> the echo
  // upstream (stands in for the Expense PEP) so forwarded headers are observable.
  const restoreGatewayEnv = withEnv({
    NODE_ENV: 'production',
    PORT: '4000',
    LOG_LEVEL: 'error',
    IDENTITY_JWKS_URL: `${identity.url}/.well-known/jwks.json`,
    IDENTITY_ISSUER: ISSUER,
    IDENTITY_AUDIENCE: AUDIENCE,
    JWKS_CACHE_TTL_SECONDS: '300',
    JWT_CLOCK_TOLERANCE_SECONDS: '60',
    INTERNAL_TOKEN_SECRET: 'int-test-secret',
    INTERNAL_TOKEN_KID: 'gw-int-2026',
    INTERNAL_TOKEN_ISSUER: 'api-gateway',
    INTERNAL_TOKEN_TTL_SECONDS: '120',
    IDENTITY_URL: identity.url,
    AUTHZ_ADMIN_URL: echoUrl,
    EXPENSE_URL: echoUrl,
    UPSTREAM_TIMEOUT_MS: '10000',
    // Disable rate limiting so the suite's repeated calls are deterministic.
    RATE_LIMIT_ENABLED: 'false',
    RATE_LIMIT_WINDOW_MS: '60000',
    RATE_LIMIT_MAX: '1000',
  });
  const gateway = await bootApp(GatewayAppModule, GatewayFilter, true);
  restoreGatewayEnv();

  return {
    gatewayUrl: gateway.url,
    identityUrl: identity.url,
    lastEcho: () => lastEcho,
    stop: async (): Promise<void> => {
      await gateway.app.close();
      await identity.app.close();
      await new Promise<void>((resolve, reject) => {
        echo.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    },
  };
}

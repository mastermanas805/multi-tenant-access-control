import 'reflect-metadata';

import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { ConfigService } from './config/config.service';
import { GlobalExceptionFilter } from './shared/presentation/global-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // JSON logs by default; the LoggingInterceptor adds per-request lines.
    logger: ['error', 'warn', 'log'],
    bufferLogs: false,
    // Capture the raw request body so the reverse proxy can forward it verbatim
    // (bytes preserved exactly) to the upstream service.
    rawBody: true,
  });

  const config = app.get(ConfigService);

  // Trust the edge proxy/LB so req.ip reflects the real client (rate limiting).
  app.set('trust proxy', true);

  // Security headers (DESIGN §10).
  app.use(helmet());

  // URI versioning so the gateway speaks the same /v1/... scheme it forwards.
  // Health + the aggregated docs are version-neutral.
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // Strict, transforming validation for any gateway-local request DTOs.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // Single error-envelope translation point (DESIGN §8.1).
  app.useGlobalFilters(app.get(GlobalExceptionFilter));

  // Aggregated OpenAPI at /docs. The gateway proxies the downstream services, so
  // this surfaces the EDGE contract (auth + routing map + health); each service
  // also publishes its own /docs behind the gateway. DESIGN §8.
  const swaggerConfig = new DocumentBuilder()
    .setTitle('API Gateway')
    .setDescription(
      'Multi-tenant access control — authN edge. Validates the user JWT (JWKS), ' +
        'rate-limits, mints a signed internal identity token, and routes: ' +
        '/auth/* -> identity; /v1/expenses* -> expense; ' +
        '/v1/{tenants,org-units,roles,permissions,role-assignments,policies}* and /admin/* -> authz-admin. ' +
        'DESIGN §4.1/§4.3/§5/§7.',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  // Graceful shutdown via lifecycle hooks.
  app.enableShutdownHooks();

  await app.listen(config.values.PORT);
  new Logger('Bootstrap').log(
    `gateway listening on :${String(config.values.PORT)} (docs at /docs)`,
  );
}

void bootstrap();

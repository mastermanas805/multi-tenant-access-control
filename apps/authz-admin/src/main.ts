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
  });

  const config = app.get(ConfigService);

  // Security headers (DESIGN §10).
  app.use(helmet());

  // URI versioning: /v1/... (DESIGN §8.1). Health is version-neutral.
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // Strict, transforming validation for every request DTO.
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

  // OpenAPI at /docs.
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Authorization Admin (PAP)')
    .setDescription('Multi-tenant access control — control plane / PAP. DESIGN §8.')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  // Graceful shutdown: closes DB pool etc. via lifecycle hooks.
  app.enableShutdownHooks();

  await app.listen(config.values.PORT);
  new Logger('Bootstrap').log(
    `authz-admin listening on :${String(config.values.PORT)} (docs at /docs)`,
  );
}

void bootstrap();

import { randomUUID } from 'node:crypto';

import { type INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { type CursorPage, type PageQuery, makeCursorPage } from '@kernel/core';

import { AppModule } from '../../../app.module';
import { GlobalExceptionFilter } from '../../../shared/presentation/global-exception.filter';
import { type Tenant } from '../domain/tenant.entity';
import { type TenantRepository, TENANT_REPOSITORY } from '../domain/tenant.repository.port';
import { type TenantId } from '../domain/value-objects/tenant-id.vo';

/**
 * In-memory repository so the e2e suite runs the full HTTP -> use-case stack
 * without Postgres. Mirrors the port contract exactly.
 */
class InMemoryTenantRepository implements TenantRepository {
  private readonly byId = new Map<string, Tenant>();

  public save(tenant: Tenant): Promise<void> {
    this.byId.set(tenant.id.toString(), tenant);
    return Promise.resolve();
  }
  public findById(id: TenantId): Promise<Tenant | null> {
    return Promise.resolve(this.byId.get(id.toString()) ?? null);
  }
  public findBySlug(slug: string): Promise<Tenant | null> {
    for (const t of this.byId.values()) {
      if (t.slug === slug) {
        return Promise.resolve(t);
      }
    }
    return Promise.resolve(null);
  }
  public list(query: PageQuery): Promise<CursorPage<Tenant>> {
    const items = [...this.byId.values()].slice(0, query.limit);
    return Promise.resolve(makeCursorPage(items, null));
  }
}

describe('Tenant module (e2e)', () => {
  let app: INestApplication;
  const tenantHeader = randomUUID();
  // Tenant lifecycle is a PLATFORM-ADMIN surface (DESIGN §6 / App. A): every
  // mutation/read carries the platform-admin claim placeholder header.
  const ADMIN = 'x-platform-admin';

  beforeAll(async () => {
    // DB disabled so DatabaseModule boots without Postgres and RLS passes through.
    process.env.DB_ENABLED = 'false';
    process.env.NODE_ENV = 'test';

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(TENANT_REPOSITORY)
      .useClass(InMemoryTenantRepository)
      .compile();

    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(app.get(GlobalExceptionFilter));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects requests without the tenant header (401 + envelope)', async () => {
    const res = await request(app.getHttpServer()).get('/v1/tenants').expect(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });

  it('rejects a non-platform-admin caller with 403 (cross-tenant lifecycle is admin-only)', async () => {
    // Authenticated as a tenant but WITHOUT the platform-admin scope: must not be
    // able to enumerate, read, suspend or create tenants.
    const list = await request(app.getHttpServer())
      .get('/v1/tenants')
      .set('x-tenant-id', tenantHeader)
      .expect(403);
    expect(list.body.error.code).toBe('forbidden');

    await request(app.getHttpServer())
      .post('/v1/tenants')
      .set('x-tenant-id', tenantHeader)
      .send({ name: 'Sneaky', slug: 'sneaky' })
      .expect(403);

    await request(app.getHttpServer())
      .post(`/v1/tenants/${randomUUID()}/suspend`)
      .set('x-tenant-id', tenantHeader)
      .send({ reason: 'malicious' })
      .expect(403);
  });

  it('creates and reads back a tenant', async () => {
    const create = await request(app.getHttpServer())
      .post('/v1/tenants')
      .set('x-tenant-id', tenantHeader)
      .set(ADMIN, 'true')
      .send({ name: 'Acme Corporation', slug: 'acme' })
      .expect(201);

    expect(create.body.status).toBe('active');
    expect(create.body.isolationTier).toBe('pool');
    expect(create.body.version).toBe(1);

    const id = create.body.id as string;
    const get = await request(app.getHttpServer())
      .get(`/v1/tenants/${id}`)
      .set('x-tenant-id', tenantHeader)
      .set(ADMIN, 'true')
      .expect(200);
    expect(get.body.slug).toBe('acme');
  });

  it('rejects a duplicate slug with 409 + the error envelope', async () => {
    await request(app.getHttpServer())
      .post('/v1/tenants')
      .set('x-tenant-id', tenantHeader)
      .set(ADMIN, 'true')
      .send({ name: 'Globex', slug: 'globex' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/v1/tenants')
      .set('x-tenant-id', tenantHeader)
      .set(ADMIN, 'true')
      .send({ name: 'Globex Two', slug: 'globex' })
      .expect(409);

    expect(res.body.error.code).toBe('conflict');
    expect(res.body.error.reason).toBe('tenant_slug_taken');
    expect(res.headers['x-trace-id']).toBeDefined();
  });

  it('returns 400 + validation envelope for a bad slug', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/tenants')
      .set('x-tenant-id', tenantHeader)
      .set(ADMIN, 'true')
      .send({ name: 'Bad', slug: 'Not Valid' })
      .expect(400);
    expect(res.body.error.code).toBe('validation_failed');
  });

  it('suspends a tenant and emits the suspended state', async () => {
    const created = await request(app.getHttpServer())
      .post('/v1/tenants')
      .set('x-tenant-id', tenantHeader)
      .set(ADMIN, 'true')
      .send({ name: 'Initech', slug: 'initech' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/v1/tenants/${created.body.id as string}/suspend`)
      .set('x-tenant-id', tenantHeader)
      .set(ADMIN, 'true')
      .send({ reason: 'Non-payment' })
      .expect(200);

    expect(res.body.status).toBe('suspended');
    expect(res.body.version).toBe(2);
  });
});

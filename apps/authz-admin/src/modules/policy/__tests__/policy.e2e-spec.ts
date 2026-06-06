import { randomUUID } from 'node:crypto';

import { type INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { Injectable } from '@nestjs/common';

import { type CursorPage, type PageQuery, makeCursorPage } from '@kernel/core';

import { AppModule } from '../../../app.module';
import { TenantContextService } from '../../../shared/infrastructure/database/tenant-context';
import { GlobalExceptionFilter } from '../../../shared/presentation/global-exception.filter';
import { type Policy } from '../domain/policy.entity';
import { type PolicyRepository, POLICY_REPOSITORY } from '../domain/policy.repository.port';
import { type PolicyId } from '../domain/value-objects/policy-id.vo';
import { type PolicyScope } from '../domain/value-objects/policy-scope.vo';

/**
 * In-memory repository so the e2e suite runs the full HTTP -> use-case stack
 * without Postgres. Mirrors the port contract exactly (RLS is pass-through when
 * DB is disabled, so no tenant filtering is needed here). Like the real TypeORM
 * adapter it stamps the owning tenant from the ambient context on save.
 */
@Injectable()
class InMemoryPolicyRepository implements PolicyRepository {
  private readonly byId = new Map<string, Policy>();

  constructor(private readonly tenantContext: TenantContextService) {}

  public save(policy: Policy): Promise<void> {
    policy.stampTenant(this.tenantContext.getTenantId());
    this.byId.set(policy.id.toString(), policy);
    return Promise.resolve();
  }
  public findById(id: PolicyId): Promise<Policy | null> {
    return Promise.resolve(this.byId.get(id.toString()) ?? null);
  }
  public findLatestForScope(scope: PolicyScope): Promise<Policy | null> {
    let latest: Policy | null = null;
    for (const p of this.byId.values()) {
      if (p.scope.equals(scope) && (!latest || p.version > latest.version)) {
        latest = p;
      }
    }
    return Promise.resolve(latest);
  }
  public findByScopeAndVersion(scope: PolicyScope, version: number): Promise<Policy | null> {
    for (const p of this.byId.values()) {
      if (p.scope.equals(scope) && p.version === version) {
        return Promise.resolve(p);
      }
    }
    return Promise.resolve(null);
  }
  public list(query: PageQuery): Promise<CursorPage<Policy>> {
    const items = [...this.byId.values()].slice(0, query.limit);
    return Promise.resolve(makeCursorPage(items, null));
  }
}

describe('Policy module (e2e)', () => {
  let app: INestApplication;
  const tenantHeader = randomUUID();

  beforeAll(async () => {
    // DB disabled so DatabaseModule boots without Postgres and RLS passes through.
    process.env.DB_ENABLED = 'false';
    process.env.NODE_ENV = 'test';

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(POLICY_REPOSITORY)
      .useClass(InMemoryPolicyRepository)
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
    const res = await request(app.getHttpServer()).get('/v1/policies').expect(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });

  it('publishes a staged policy and reads it back', async () => {
    const publish = await request(app.getHttpServer())
      .post('/v1/policies')
      .set('x-tenant-id', tenantHeader)
      .send({
        scope: 'acme.finance',
        rule: { effect: 'ALLOW', condition: 'amount < 10000' },
        effectiveDate: '2026-07-01T00:00:00.000Z',
      })
      .expect(201);

    expect(publish.body.status).toBe('staged');
    expect(publish.body.scope).toBe('acme.finance');
    expect(publish.body.version).toBe(1);

    const id = publish.body.id as string;
    const get = await request(app.getHttpServer())
      .get(`/v1/policies/${id}`)
      .set('x-tenant-id', tenantHeader)
      .expect(200);
    expect(get.body.version).toBe(1);
    expect(get.body.rule).toEqual({ effect: 'ALLOW', condition: 'amount < 10000' });
  });

  it('activates a staged policy version', async () => {
    const publish = await request(app.getHttpServer())
      .post('/v1/policies')
      .set('x-tenant-id', tenantHeader)
      .send({
        scope: 'acme.hr',
        rule: { effect: 'ALLOW' },
        effectiveDate: '2026-07-01T00:00:00.000Z',
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/v1/policies/${publish.body.id as string}/activate`)
      .set('x-tenant-id', tenantHeader)
      .expect(200);

    expect(res.body.status).toBe('active');
    expect(res.body.version).toBe(1);
  });

  it('bumps the monotonic version on a second publish of the same scope', async () => {
    await request(app.getHttpServer())
      .post('/v1/policies')
      .set('x-tenant-id', tenantHeader)
      .send({ scope: 'acme.ops', rule: { v: 1 }, effectiveDate: '2026-07-01T00:00:00.000Z' })
      .expect(201);

    const second = await request(app.getHttpServer())
      .post('/v1/policies')
      .set('x-tenant-id', tenantHeader)
      .send({ scope: 'acme.ops', rule: { v: 2 }, effectiveDate: '2026-08-01T00:00:00.000Z' })
      .expect(201);

    expect(second.body.version).toBe(2);
  });

  it('rolls a scope back to a prior version as a new staged version', async () => {
    const v1 = await request(app.getHttpServer())
      .post('/v1/policies')
      .set('x-tenant-id', tenantHeader)
      .send({ scope: 'acme.legal', rule: { gen: 1 }, effectiveDate: '2026-07-01T00:00:00.000Z' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/v1/policies')
      .set('x-tenant-id', tenantHeader)
      .send({ scope: 'acme.legal', rule: { gen: 2 }, effectiveDate: '2026-08-01T00:00:00.000Z' })
      .expect(201);

    const rolled = await request(app.getHttpServer())
      .post(`/v1/policies/${v1.body.id as string}/rollback`)
      .set('x-tenant-id', tenantHeader)
      .send({ toVersion: 1 })
      .expect(200);

    expect(rolled.body.version).toBe(3); // forward-only: latest (2) + 1
    expect(rolled.body.status).toBe('staged');
    expect(rolled.body.rule).toEqual({ gen: 1 });
  });

  it('returns 409 + envelope when rolling back to a non-existent version', async () => {
    const created = await request(app.getHttpServer())
      .post('/v1/policies')
      .set('x-tenant-id', tenantHeader)
      .send({ scope: 'acme.support', rule: { x: 1 }, effectiveDate: '2026-07-01T00:00:00.000Z' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/v1/policies/${created.body.id as string}/rollback`)
      .set('x-tenant-id', tenantHeader)
      .send({ toVersion: 99 })
      .expect(409);

    expect(res.body.error.code).toBe('conflict');
    expect(res.body.error.reason).toBe('policy_version_not_found');
    expect(res.headers['x-trace-id']).toBeDefined();
  });

  it('returns 400 + validation envelope for a malformed scope', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/policies')
      .set('x-tenant-id', tenantHeader)
      .send({ scope: 'Acme Finance', rule: {}, effectiveDate: '2026-07-01T00:00:00.000Z' })
      .expect(400);
    expect(res.body.error.code).toBe('validation_failed');
  });
});

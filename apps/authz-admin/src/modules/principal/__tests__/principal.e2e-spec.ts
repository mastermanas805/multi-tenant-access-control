import { randomUUID } from 'node:crypto';

import { type INestApplication, Injectable, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../../app.module';
import { GlobalExceptionFilter } from '../../../shared/presentation/global-exception.filter';
import {
  type PrincipalProjection,
  type PrincipalRoleGrant,
  PRINCIPAL_PROJECTION,
} from '../domain/principal-projection.port';

/**
 * In-memory projection so the e2e runs the full HTTP -> guard -> use-case stack
 * without Postgres. Mirrors the port contract: returns the seeded grants whose
 * scope is on the requested ancestor-or-self chain (the inheritance filter the
 * real TypeORM adapter applies in SQL).
 */
@Injectable()
class InMemoryPrincipalProjection implements PrincipalProjection {
  // Riya: finance_manager @ acme.finance (so resolving acme.finance hits it).
  private readonly grants: Record<string, PrincipalRoleGrant[]> = {
    riya: [{ roleKey: 'finance_manager', scope: 'acme.finance' }],
    sam: [{ roleKey: 'engineer', scope: 'acme' }],
  };

  public findActiveGrants(userId: string, scopeChain: string[]): Promise<PrincipalRoleGrant[]> {
    const all = this.grants[userId] ?? [];
    return Promise.resolve(all.filter((g) => scopeChain.includes(g.scope)));
  }
}

describe('Principal (PIP) module (e2e)', () => {
  let app: INestApplication;
  const tenantId = randomUUID();

  beforeAll(async () => {
    // DB disabled so DatabaseModule boots without Postgres and RLS passes through.
    process.env.DB_ENABLED = 'false';
    process.env.NODE_ENV = 'test';
    process.env.CERBOS_PUBLISH_ENABLED = 'false';

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PRINCIPAL_PROJECTION)
      .useClass(InMemoryPrincipalProjection)
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

  it('rejects a request without the tenantId query (401 + envelope)', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/principals/riya/effective?scope=acme.finance')
      .expect(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });

  it('rejects a non-UUID tenantId (401)', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/principals/riya/effective?tenantId=not-a-uuid&scope=acme.finance')
      .expect(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });

  it('rejects a malformed scope (400 + validation envelope)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/principals/riya/effective?tenantId=${tenantId}&scope=Acme%20Finance`)
      .expect(400);
    expect(res.body.error.code).toBe('validation_failed');
  });

  it('resolves the effective principal (roles + attr) for the requested scope', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/principals/riya/effective?tenantId=${tenantId}&scope=acme.finance`)
      .expect(200);

    expect(res.body.id).toBe('riya');
    expect(res.body.tenantId).toBe(tenantId);
    expect(res.body.roles).toEqual(['finance_manager']);
    expect(res.body.attr).toEqual({ tenantId, department: 'finance' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('INHERITS an ancestor-scoped role when resolving a deeper scope', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/principals/sam/effective?tenantId=${tenantId}&scope=acme.finance.emea`)
      .expect(200);

    expect(res.body.roles).toEqual(['engineer']);
    expect(res.body.attr).toEqual({ tenantId }); // root grant -> no department
  });

  it('returns an empty role set for a principal with no grants in scope', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/principals/nobody/effective?tenantId=${tenantId}&scope=acme.finance`)
      .expect(200);

    expect(res.body.roles).toEqual([]);
    expect(res.body.attr).toEqual({ tenantId });
  });
});

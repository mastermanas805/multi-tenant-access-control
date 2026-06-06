import { randomUUID } from 'node:crypto';

import { type INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { type CursorPage, type PageQuery, makeCursorPage } from '@kernel/core';

import { AppModule } from '../../../app.module';
import { GlobalExceptionFilter } from '../../../shared/presentation/global-exception.filter';
import { type Role } from '../domain/role.entity';
import { type RoleRepository, ROLE_REPOSITORY } from '../domain/role.repository.port';
import { type RoleId } from '../domain/value-objects/role-id.vo';
import { RoleModule } from '../role.module';

/**
 * In-memory repository so the e2e suite runs the full HTTP -> use-case stack
 * without Postgres. Mirrors the port contract exactly. Key lookups are scoped to
 * the simulated tenant via the role's own tenantId (RLS is mocked away here).
 */
class InMemoryRoleRepository implements RoleRepository {
  private readonly byId = new Map<string, Role>();

  public save(role: Role): Promise<void> {
    this.byId.set(role.id.toString(), role);
    return Promise.resolve();
  }
  public findById(id: RoleId): Promise<Role | null> {
    return Promise.resolve(this.byId.get(id.toString()) ?? null);
  }
  public findByKey(key: string): Promise<Role | null> {
    for (const r of this.byId.values()) {
      if (r.key === key) {
        return Promise.resolve(r);
      }
    }
    return Promise.resolve(null);
  }
  public list(query: PageQuery): Promise<CursorPage<Role>> {
    const items = [...this.byId.values()].slice(0, query.limit);
    return Promise.resolve(makeCursorPage(items, null));
  }
}

describe('Role module (e2e)', () => {
  let app: INestApplication;
  const tenantHeader = randomUUID();

  beforeAll(async () => {
    // DB disabled so DatabaseModule boots without Postgres and RLS passes through.
    process.env.DB_ENABLED = 'false';
    process.env.NODE_ENV = 'test';

    const moduleRef: TestingModule = await Test.createTestingModule({
      // RoleModule is also imported directly so this suite is self-contained even
      // before app.module wiring lands; Nest dedupes by class reference.
      imports: [AppModule, RoleModule],
    })
      .overrideProvider(ROLE_REPOSITORY)
      .useClass(InMemoryRoleRepository)
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
    const res = await request(app.getHttpServer()).get('/v1/roles').expect(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });

  it('creates and reads back a role with its permissions', async () => {
    const create = await request(app.getHttpServer())
      .post('/v1/roles')
      .set('x-tenant-id', tenantHeader)
      .send({
        key: 'finance_manager',
        scope: 'acme.finance',
        description: 'Approves finance expense reports',
        permissions: ['expense:report:read', 'expense:report:approve'],
      })
      .expect(201);

    expect(create.body.tenantId).toBe(tenantHeader);
    expect(create.body.key).toBe('finance_manager');
    expect(create.body.permissions).toEqual(['expense:report:read', 'expense:report:approve']);
    expect(create.body.version).toBe(1);

    const id = create.body.id as string;
    const get = await request(app.getHttpServer())
      .get(`/v1/roles/${id}`)
      .set('x-tenant-id', tenantHeader)
      .expect(200);
    expect(get.body.scope).toBe('acme.finance');
  });

  it('rejects a duplicate key with 409 + the error envelope', async () => {
    await request(app.getHttpServer())
      .post('/v1/roles')
      .set('x-tenant-id', tenantHeader)
      .send({ key: 'auditor', scope: 'acme' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/v1/roles')
      .set('x-tenant-id', tenantHeader)
      .send({ key: 'auditor', scope: 'acme.finance' })
      .expect(409);

    expect(res.body.error.code).toBe('conflict');
    expect(res.body.error.reason).toBe('role_key_taken');
    expect(res.headers['x-trace-id']).toBeDefined();
  });

  it('returns 400 + validation envelope for a bad key', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/roles')
      .set('x-tenant-id', tenantHeader)
      .send({ key: 'Not Valid', scope: 'acme' })
      .expect(400);
    expect(res.body.error.code).toBe('validation_failed');
  });

  it('grants then revokes a permission, bumping the version each time', async () => {
    const created = await request(app.getHttpServer())
      .post('/v1/roles')
      .set('x-tenant-id', tenantHeader)
      .send({ key: 'support_agent', scope: 'acme.support' })
      .expect(201);

    const id = created.body.id as string;

    const granted = await request(app.getHttpServer())
      .post(`/v1/roles/${id}/permissions`)
      .set('x-tenant-id', tenantHeader)
      .send({ permission: 'ticket:ticket:read' })
      .expect(200);
    expect(granted.body.permissions).toEqual(['ticket:ticket:read']);
    expect(granted.body.version).toBe(2);

    const revoked = await request(app.getHttpServer())
      .delete(`/v1/roles/${id}/permissions/ticket:ticket:read`)
      .set('x-tenant-id', tenantHeader)
      .expect(200);
    expect(revoked.body.permissions).toEqual([]);
    expect(revoked.body.version).toBe(3);
  });

  it('rejects re-granting an existing permission with 409 + reason', async () => {
    const created = await request(app.getHttpServer())
      .post('/v1/roles')
      .set('x-tenant-id', tenantHeader)
      .send({ key: 'billing_admin', scope: 'acme.billing', permissions: ['invoice:invoice:read'] })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/v1/roles/${created.body.id as string}/permissions`)
      .set('x-tenant-id', tenantHeader)
      .send({ permission: 'invoice:invoice:read' })
      .expect(409);

    expect(res.body.error.code).toBe('conflict');
    expect(res.body.error.reason).toBe('role_permission_already_granted');
  });
});

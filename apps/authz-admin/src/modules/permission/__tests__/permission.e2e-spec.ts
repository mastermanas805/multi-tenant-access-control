import { randomUUID } from 'node:crypto';

import { type INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { type CursorPage, type PageQuery, makeCursorPage } from '@kernel/core';

import { identityHeaders } from '../../../../test/identity-header';
import { AppModule } from '../../../app.module';
import { GlobalExceptionFilter } from '../../../shared/presentation/global-exception.filter';
import { type Permission } from '../domain/permission.entity';
import {
  type PermissionRepository,
  PERMISSION_REPOSITORY,
} from '../domain/permission.repository.port';
import { type PermissionId } from '../domain/value-objects/permission-id.vo';

/**
 * In-memory repository so the e2e suite runs the full HTTP -> use-case stack
 * without Postgres. Mirrors the port contract exactly.
 */
class InMemoryPermissionRepository implements PermissionRepository {
  private readonly byId = new Map<string, Permission>();

  public save(permission: Permission): Promise<void> {
    this.byId.set(permission.id.toString(), permission);
    return Promise.resolve();
  }
  public findById(id: PermissionId): Promise<Permission | null> {
    return Promise.resolve(this.byId.get(id.toString()) ?? null);
  }
  public findByKey(key: string): Promise<Permission | null> {
    for (const p of this.byId.values()) {
      if (p.key.toString() === key) {
        return Promise.resolve(p);
      }
    }
    return Promise.resolve(null);
  }
  public list(query: PageQuery): Promise<CursorPage<Permission>> {
    const items = [...this.byId.values()].slice(0, query.limit);
    return Promise.resolve(makeCursorPage(items, null));
  }
}

describe('Permission module (e2e)', () => {
  let app: INestApplication;
  const tenantHeader = randomUUID();
  // The global catalog is shared platform-wide: WRITES require the VERIFIED
  // platform-admin claim (DESIGN §6 / App. A); reads stay broadly available.
  // Identity flows via the signed internal token (DESIGN §5/§7): idHeader is a
  // non-admin caller, adminHeader carries the verified platform-admin claim.
  const idHeader = identityHeaders({ tenantId: tenantHeader });
  const adminHeader = identityHeaders({ tenantId: tenantHeader, platformAdmin: true });

  beforeAll(async () => {
    // DB disabled so DatabaseModule boots without Postgres and RLS passes through.
    process.env.DB_ENABLED = 'false';
    process.env.NODE_ENV = 'test';

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PERMISSION_REPOSITORY)
      .useClass(InMemoryPermissionRepository)
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
    const res = await request(app.getHttpServer()).get('/v1/permissions').expect(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });

  it('rejects a catalog write from a non-platform-admin caller with 403', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/permissions')
      .set(idHeader)
      .send({ key: 'sneaky:catalog:write', description: 'should be blocked' })
      .expect(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('creates and reads back a permission', async () => {
    const create = await request(app.getHttpServer())
      .post('/v1/permissions')
      .set(adminHeader)
      .send({ key: 'expense:report:approve', description: 'Approve an expense report' })
      .expect(201);

    expect(create.body.key).toBe('expense:report:approve');
    expect(create.body.version).toBe(1);

    // Reads stay broadly available — no platform-admin claim required.
    const id = create.body.id as string;
    const get = await request(app.getHttpServer())
      .get(`/v1/permissions/${id}`)
      .set(idHeader)
      .expect(200);
    expect(get.body.key).toBe('expense:report:approve');
  });

  it('rejects a duplicate key with 409 + the error envelope', async () => {
    await request(app.getHttpServer())
      .post('/v1/permissions')
      .set(adminHeader)
      .send({ key: 'invoice:line:edit', description: 'Edit an invoice line' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/v1/permissions')
      .set(adminHeader)
      .send({ key: 'invoice:line:edit', description: 'Edit an invoice line (dup)' })
      .expect(409);

    expect(res.body.error.code).toBe('conflict');
    expect(res.body.error.reason).toBe('permission_key_taken');
    expect(res.headers['x-trace-id']).toBeDefined();
  });

  it('returns 400 + validation envelope for a malformed key', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/permissions')
      .set(adminHeader)
      .send({ key: 'NotValid', description: 'bad' })
      .expect(400);
    expect(res.body.error.code).toBe('validation_failed');
  });

  it('lists permissions for the catalog', async () => {
    const res = await request(app.getHttpServer()).get('/v1/permissions').set(idHeader).expect(200);

    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBeGreaterThan(0);
  });
});

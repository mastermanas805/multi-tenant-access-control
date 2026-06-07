import { randomUUID } from 'node:crypto';

import { type INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { type CursorPage, type PageQuery, makeCursorPage } from '@kernel/core';

import { AppModule } from '../../../app.module';
import { identityHeaders } from '../../../../test/identity-header';
import { GlobalExceptionFilter } from '../../../shared/presentation/global-exception.filter';
import { type OrgUnit } from '../domain/org-unit.entity';
import { type OrgUnitRepository, ORG_UNIT_REPOSITORY } from '../domain/org-unit.repository.port';
import { type OrgPath } from '../domain/value-objects/org-path.vo';
import { type OrgUnitId } from '../domain/value-objects/org-unit-id.vo';

/**
 * In-memory repository so the e2e suite runs the full HTTP -> use-case stack
 * without Postgres. Mirrors the port contract exactly (path-prefix subtree
 * semantics included).
 */
class InMemoryOrgUnitRepository implements OrgUnitRepository {
  private readonly byId = new Map<string, OrgUnit>();

  public save(orgUnit: OrgUnit): Promise<void> {
    this.byId.set(orgUnit.id.toString(), orgUnit);
    return Promise.resolve();
  }
  public saveMany(orgUnits: readonly OrgUnit[]): Promise<void> {
    for (const unit of orgUnits) {
      this.byId.set(unit.id.toString(), unit);
    }
    return Promise.resolve();
  }
  public findById(id: OrgUnitId): Promise<OrgUnit | null> {
    return Promise.resolve(this.byId.get(id.toString()) ?? null);
  }
  public findByPath(path: OrgPath): Promise<OrgUnit | null> {
    for (const unit of this.byId.values()) {
      if (unit.path.toString() === path.toString()) {
        return Promise.resolve(unit);
      }
    }
    return Promise.resolve(null);
  }
  public listSubtree(rootPath: OrgPath, query: PageQuery): Promise<CursorPage<OrgUnit>> {
    const root = rootPath.toString();
    const items = [...this.byId.values()]
      .filter((u) => u.path.toString() === root || u.path.toString().startsWith(`${root}.`))
      .sort((a, b) => a.path.toString().localeCompare(b.path.toString()))
      .slice(0, query.limit);
    return Promise.resolve(makeCursorPage(items, null));
  }
  public findDescendants(path: OrgPath): Promise<OrgUnit[]> {
    const prefix = `${path.toString()}.`;
    const items = [...this.byId.values()]
      .filter((u) => u.path.toString().startsWith(prefix))
      .sort((a, b) => a.path.toString().localeCompare(b.path.toString()));
    return Promise.resolve(items);
  }
}

describe('OrgUnit module (e2e)', () => {
  let app: INestApplication;
  const tenantHeader = randomUUID();
  // Identity flows via the VERIFIED signed internal token (DESIGN §5/§6/§7); the
  // raw UUID is kept for tenant-id assertions, idHeader carries it as the token.
  const idHeader = identityHeaders({ tenantId: tenantHeader });

  beforeAll(async () => {
    // DB disabled so DatabaseModule boots without Postgres and RLS passes through.
    process.env.DB_ENABLED = 'false';
    process.env.NODE_ENV = 'test';

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ORG_UNIT_REPOSITORY)
      .useClass(InMemoryOrgUnitRepository)
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
    const res = await request(app.getHttpServer()).get('/v1/org-units?rootPath=acme').expect(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });

  it('creates a root and a child, deriving the child path from the parent', async () => {
    const root = await request(app.getHttpServer())
      .post('/v1/org-units')
      .set(idHeader)
      .send({ segment: 'acme', name: 'Acme' })
      .expect(201);

    expect(root.body.path).toBe('acme');
    expect(root.body.parentId).toBeNull();
    expect(root.body.version).toBe(1);

    const child = await request(app.getHttpServer())
      .post('/v1/org-units')
      .set(idHeader)
      .send({ segment: 'finance', name: 'Finance', parentId: root.body.id as string })
      .expect(201);

    expect(child.body.path).toBe('acme.finance');

    const get = await request(app.getHttpServer())
      .get(`/v1/org-units/${child.body.id as string}`)
      .set(idHeader)
      .expect(200);
    expect(get.body.path).toBe('acme.finance');
  });

  it('rejects a duplicate path with 409 + the error envelope', async () => {
    await request(app.getHttpServer())
      .post('/v1/org-units')
      .set(idHeader)
      .send({ segment: 'globex', name: 'Globex' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/v1/org-units')
      .set(idHeader)
      .send({ segment: 'globex', name: 'Globex Two' })
      .expect(409);

    expect(res.body.error.code).toBe('conflict');
    expect(res.body.error.reason).toBe('org_unit_path_taken');
    expect(res.headers['x-trace-id']).toBeDefined();
  });

  it('returns 400 + validation envelope for a bad segment', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/org-units')
      .set(idHeader)
      .send({ segment: 'Not Valid', name: 'Bad' })
      .expect(400);
    expect(res.body.error.code).toBe('validation_failed');
  });

  it('lists a subtree and moves a node, recomputing descendant paths', async () => {
    const corp = await request(app.getHttpServer())
      .post('/v1/org-units')
      .set(idHeader)
      .send({ segment: 'corp', name: 'Corp' })
      .expect(201);

    const sales = await request(app.getHttpServer())
      .post('/v1/org-units')
      .set(idHeader)
      .send({ segment: 'sales', name: 'Sales', parentId: corp.body.id as string })
      .expect(201);

    await request(app.getHttpServer())
      .post('/v1/org-units')
      .set(idHeader)
      .send({ segment: 'apac', name: 'APAC', parentId: sales.body.id as string })
      .expect(201);

    const subtree = await request(app.getHttpServer())
      .get('/v1/org-units?rootPath=corp.sales')
      .set(idHeader)
      .expect(200);
    expect(subtree.body.items.map((i: { path: string }) => i.path)).toEqual([
      'corp.sales',
      'corp.sales.apac',
    ]);

    // Move corp.sales -> root, descendant apac rebases under the new path.
    const moved = await request(app.getHttpServer())
      .post(`/v1/org-units/${sales.body.id as string}/move`)
      .set(idHeader)
      .send({ newParentId: null })
      .expect(200);
    expect(moved.body.path).toBe('sales');
    expect(moved.body.version).toBe(2);

    const afterMove = await request(app.getHttpServer())
      .get('/v1/org-units?rootPath=sales')
      .set(idHeader)
      .expect(200);
    expect(afterMove.body.items.map((i: { path: string }) => i.path)).toEqual([
      'sales',
      'sales.apac',
    ]);
  });
});

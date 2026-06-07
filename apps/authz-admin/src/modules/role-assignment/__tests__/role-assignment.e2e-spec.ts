import { randomUUID } from 'node:crypto';

import { type INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';

import {
  type CursorPage,
  type DomainEvent,
  type IDomainEventDispatcher,
  type PageQuery,
  DOMAIN_EVENT_DISPATCHER,
  makeCursorPage,
} from '@kernel/core';

import { identityHeaders } from '../../../../test/identity-header';
import { AppModule } from '../../../app.module';
import { GlobalExceptionFilter } from '../../../shared/presentation/global-exception.filter';
import { type RoleAssignment } from '../domain/role-assignment.entity';
import {
  type RoleAssignmentRepository,
  ROLE_ASSIGNMENT_REPOSITORY,
} from '../domain/role-assignment.repository.port';
import { type RoleAssignmentId } from '../domain/value-objects/role-assignment-id.vo';
import { RoleAssignmentModule } from '../role-assignment.module';

/**
 * In-memory repository so the e2e suite runs the full HTTP -> use-case stack
 * without Postgres. Mirrors the port contract exactly.
 */
class InMemoryRoleAssignmentRepository implements RoleAssignmentRepository {
  private readonly byId = new Map<string, RoleAssignment>();

  public save(assignment: RoleAssignment): Promise<void> {
    this.byId.set(assignment.id.toString(), assignment);
    return Promise.resolve();
  }
  public findById(id: RoleAssignmentId): Promise<RoleAssignment | null> {
    return Promise.resolve(this.byId.get(id.toString()) ?? null);
  }
  public findActiveAssignment(
    userId: string,
    roleId: string,
    scope: string,
  ): Promise<RoleAssignment | null> {
    for (const a of this.byId.values()) {
      if (
        a.isActive &&
        a.userId === userId &&
        a.roleId === roleId &&
        a.scope.toString() === scope
      ) {
        return Promise.resolve(a);
      }
    }
    return Promise.resolve(null);
  }
  public listForUser(userId: string, query: PageQuery): Promise<CursorPage<RoleAssignment>> {
    const items = [...this.byId.values()].filter((a) => a.userId === userId).slice(0, query.limit);
    return Promise.resolve(makeCursorPage(items, null));
  }
}

/** Captures dispatched events so the test can assert the §3.4 seam fired. */
class RecordingDispatcher implements IDomainEventDispatcher {
  public readonly dispatched: DomainEvent[] = [];

  public dispatch(events: readonly DomainEvent[]): Promise<void> {
    this.dispatched.push(...events);
    return Promise.resolve();
  }
}

describe('RoleAssignment module (e2e)', () => {
  let app: INestApplication;
  const dispatcher = new RecordingDispatcher();
  const tenantHeader = randomUUID();
  // Identity flows via the VERIFIED signed internal token (DESIGN §5/§6/§7).
  // Granting/revoking a role is a high-privilege IAM mutation, so the write routes
  // are platform-admin-only (finding 2): adminHeader carries the verified
  // platform-admin claim; nonAdminHeader is an authenticated but NON-admin tenant
  // user (e.g. an engineer) who must be rejected. adminAsActor pins the actorId so
  // the test can assert delegatedBy is stamped from the verified caller, not the body.
  const adminHeader = identityHeaders({ tenantId: tenantHeader, platformAdmin: true });
  const nonAdminHeader = identityHeaders({ tenantId: tenantHeader });
  const adminAsActor = identityHeaders({
    tenantId: tenantHeader,
    sub: 'admin_real',
    actorId: 'admin_real',
    platformAdmin: true,
  });

  beforeAll(async () => {
    // DB disabled so DatabaseModule boots without Postgres and RLS passes through.
    process.env.DB_ENABLED = 'false';
    process.env.NODE_ENV = 'test';

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule, RoleAssignmentModule],
    })
      .overrideProvider(ROLE_ASSIGNMENT_REPOSITORY)
      .useClass(InMemoryRoleAssignmentRepository)
      .overrideProvider(DOMAIN_EVENT_DISPATCHER)
      .useValue(dispatcher)
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
    const res = await request(app.getHttpServer())
      .get('/v1/role-assignments?userId=u1')
      .expect(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });

  it('rejects a NON-admin caller granting a role with 403 (no in-tenant self-escalation — finding 2)', async () => {
    // An authenticated tenant user (e.g. Sam the engineer) must NOT be able to grant
    // himself finance_manager via the gateway endpoint. The server gate is the
    // authority — not the UI hiding the Admin screen (DESIGN §6/§7).
    const res = await request(app.getHttpServer())
      .post('/v1/role-assignments')
      .set(nonAdminHeader)
      .send({ userId: 'sam', roleId: 'role_finance_manager', scope: 'acme.finance' })
      .expect(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('rejects a NON-admin caller revoking an assignment with 403 (finding 2)', async () => {
    const created = await request(app.getHttpServer())
      .post('/v1/role-assignments')
      .set(adminHeader)
      .send({ userId: 'user_guarded', roleId: 'role_g', scope: 'acme.ops' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/v1/role-assignments/${created.body.id as string}/revoke`)
      .set(nonAdminHeader)
      .send()
      .expect(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('assigns a role (platform-admin) and lists it back for the user', async () => {
    const assign = await request(app.getHttpServer())
      .post('/v1/role-assignments')
      .set(adminHeader)
      .send({ userId: 'user_riya', roleId: 'role_7f3', scope: 'acme.finance.emea' })
      .expect(201);

    expect(assign.body.status).toBe('active');
    expect(assign.body.tenantId).toBe(tenantHeader);
    expect(assign.body.version).toBe(1);

    // List is a read — available to an authenticated (non-admin) caller in-tenant.
    const list = await request(app.getHttpServer())
      .get('/v1/role-assignments?userId=user_riya')
      .set(nonAdminHeader)
      .expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].scope).toBe('acme.finance.emea');
  });

  it('stamps delegatedBy from the VERIFIED caller (token actorId), not the body', async () => {
    const assign = await request(app.getHttpServer())
      .post('/v1/role-assignments')
      .set(adminAsActor)
      .send({ userId: 'user_deleg', roleId: 'role_d', scope: 'acme.finance' })
      .expect(201);

    // delegatedBy is the server-stamped caller identity from the signed token,
    // not anything the client sent in the body.
    expect(assign.body.delegatedBy).toBe('admin_real');
  });

  it('rejects a client-supplied delegatedBy in the body (non-whitelisted -> 400)', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/role-assignments')
      .set(adminAsActor)
      .send({
        userId: 'user_spoof',
        roleId: 'role_s',
        scope: 'acme.sales',
        delegatedBy: 'someone_else',
      })
      .expect(400);
    expect(res.body.error.code).toBe('validation_failed');
  });

  it('rejects a duplicate active assignment with 409 + the error envelope', async () => {
    await request(app.getHttpServer())
      .post('/v1/role-assignments')
      .set(adminHeader)
      .send({ userId: 'user_dup', roleId: 'role_a', scope: 'acme.sales' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/v1/role-assignments')
      .set(adminHeader)
      .send({ userId: 'user_dup', roleId: 'role_a', scope: 'acme.sales' })
      .expect(409);

    expect(res.body.error.code).toBe('conflict');
    expect(res.body.error.reason).toBe('role_assignment_exists');
    expect(res.headers['x-trace-id']).toBeDefined();
  });

  it('returns 400 + validation envelope for a bad scope path', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/role-assignments')
      .set(adminHeader)
      .send({ userId: 'user_bad', roleId: 'role_a', scope: 'Not A Path' })
      .expect(400);
    expect(res.body.error.code).toBe('validation_failed');
  });

  it('revokes an assignment (platform-admin) and dispatches RoleAssignmentRevoked (DESIGN §3.4)', async () => {
    const created = await request(app.getHttpServer())
      .post('/v1/role-assignments')
      .set(adminHeader)
      .send({ userId: 'user_revoke', roleId: 'role_b', scope: 'acme.ops' })
      .expect(201);

    const before = dispatcher.dispatched.length;

    const res = await request(app.getHttpServer())
      .post(`/v1/role-assignments/${created.body.id as string}/revoke`)
      .set(adminHeader)
      .send()
      .expect(200);

    expect(res.body.status).toBe('revoked');
    expect(res.body.version).toBe(2);
    expect(dispatcher.dispatched.length).toBe(before + 1);
    const event = dispatcher.dispatched.at(-1);
    expect(event?.eventName()).toBe('role_assignment.revoked');
  });
});

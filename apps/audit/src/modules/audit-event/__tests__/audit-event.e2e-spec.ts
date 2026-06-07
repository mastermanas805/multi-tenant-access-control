import { randomUUID } from 'node:crypto';

import { type INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../../app.module';
import { GlobalExceptionFilter } from '../../../shared/presentation/global-exception.filter';
import { AUDIT_EVENT_REPOSITORY } from '../domain/audit-event.repository.port';
import { InMemoryAuditEventRepository } from './in-memory-audit-event.repository';

/**
 * e2e for the audit module: runs the full HTTP -> use-case stack with an
 * in-memory repository (no Postgres). Covers append, hash chaining over HTTP,
 * pagination + tenant filtering, idempotency, validation, and the integrity
 * verifier exposed at GET /v1/audit/events/verify.
 */
describe('Audit module (e2e)', () => {
  let app: INestApplication;
  const tenantA = randomUUID();
  const tenantB = randomUUID();

  beforeAll(async () => {
    // DB disabled so DatabaseModule boots without Postgres.
    process.env.DB_ENABLED = 'false';
    process.env.NODE_ENV = 'test';

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AUDIT_EVENT_REPOSITORY)
      .useClass(InMemoryAuditEventRepository)
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

  function event(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      tenantId: tenantA,
      actor: 'riya',
      action: 'approve',
      decision: 'ALLOW',
      resourceKind: 'expense_report',
      resourceId: 'exp_1',
      reason: 'finance_manager same dept',
      decisionId: 'dec_1',
      traceId: 'trc_1',
      at: '2026-06-06T09:59:00.000Z',
      ...overrides,
    };
  }

  it('appends an event and returns it hash-chained from genesis', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/audit/events')
      .send(event())
      .expect(201);

    expect(res.body.seq).toBe(1);
    expect(res.body.prevHash).toBe('0'.repeat(64));
    expect(res.body.recordHash).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.decision).toBe('ALLOW');
    expect(res.headers['x-trace-id']).toBeDefined();
  });

  it('chains a second event onto the first', async () => {
    const a = await request(app.getHttpServer())
      .post('/v1/audit/events')
      .send(event({ resourceId: 'exp_2' }))
      .expect(201);
    const b = await request(app.getHttpServer())
      .post('/v1/audit/events')
      .send(event({ resourceId: 'exp_3', decision: 'DENY' }))
      .expect(201);

    expect(b.body.prevHash).toBe(a.body.recordHash);
    expect(b.body.seq).toBe((a.body.seq as number) + 1);
  });

  it('rejects an unknown decision with 400 + the error envelope', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/audit/events')
      .send(event({ decision: 'MAYBE' }))
      .expect(400);
    expect(res.body.error.code).toBe('validation_failed');
  });

  it('rejects a non-UUID tenantId with 400', async () => {
    await request(app.getHttpServer())
      .post('/v1/audit/events')
      .send(event({ tenantId: 'acme' }))
      .expect(400);
  });

  it('is idempotent on a repeated id (409 conflict)', async () => {
    const id = randomUUID();
    await request(app.getHttpServer()).post('/v1/audit/events').send(event({ id })).expect(201);

    const res = await request(app.getHttpServer())
      .post('/v1/audit/events')
      .send(event({ id }))
      .expect(409);
    expect(res.body.error.code).toBe('conflict');
    expect(res.body.error.reason).toBe('audit_event_duplicate');
  });

  it('filters the list by tenant', async () => {
    await request(app.getHttpServer())
      .post('/v1/audit/events')
      .send(event({ tenantId: tenantB, resourceId: 'gx_1' }))
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/v1/audit/events')
      .query({ tenantId: tenantB })
      .expect(200);

    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
    for (const item of res.body.items) {
      expect(item.tenantId).toBe(tenantB);
    }
  });

  it('paginates with an opaque cursor', async () => {
    const first = await request(app.getHttpServer())
      .get('/v1/audit/events')
      .query({ tenantId: tenantA, limit: 1 })
      .expect(200);

    expect(first.body.items).toHaveLength(1);
    expect(first.body.hasMore).toBe(true);
    expect(first.body.nextCursor).toBeTruthy();

    const second = await request(app.getHttpServer())
      .get('/v1/audit/events')
      .query({ tenantId: tenantA, limit: 1, cursor: first.body.nextCursor as string })
      .expect(200);

    expect(second.body.items).toHaveLength(1);
    // Newest-first paging: the second page's seq is strictly lower.
    expect(second.body.items[0].seq).toBeLessThan(first.body.items[0].seq);
  });

  it('verifies the whole chain is intact', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/audit/events/verify')
      .expect(200);

    expect(res.body.valid).toBe(true);
    expect(res.body.count).toBeGreaterThan(0);
    expect(res.body.brokenAt).toBeNull();
  });
});

import {
  type INestApplication,
  Injectable,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { type CursorPage, type PageQuery, makeCursorPage } from '@kernel/core';
import {
  type DecisionAuditRecord,
  type EffectivePrincipal,
  type InternalIdentityToken,
  type PdpCheckResult,
  type PdpPrincipal,
  type PdpResource,
} from '@contracts/core';
import { AUDIT_SINK, CerbosPdpClient, PIP_CLIENT } from '@authz/pep';

import { AppModule } from '../../../app.module';
import { GlobalExceptionFilter } from '../../../shared/presentation/global-exception.filter';
import { Expense } from '../domain/expense.entity';
import { type ExpenseRepository, EXPENSE_REPOSITORY } from '../domain/expense.repository.port';
import { type ExpenseId } from '../domain/value-objects/expense-id.vo';

const ACME = 'aaaaaaaa-0000-4000-8000-000000000001';
const GLOBEX = 'bbbbbbbb-0000-4000-8000-000000000002';

/** In-memory repository so the e2e runs HTTP -> guard -> use-case without Postgres. */
@Injectable()
class InMemoryExpenseRepository implements ExpenseRepository {
  private readonly byId = new Map<string, Expense>();

  public seed(expense: Expense): void {
    this.byId.set(expense.id.toString(), expense);
  }

  public save(expense: Expense): Promise<void> {
    this.byId.set(expense.id.toString(), expense);
    return Promise.resolve();
  }
  public findById(id: ExpenseId): Promise<Expense | null> {
    return Promise.resolve(this.byId.get(id.toString()) ?? null);
  }
  public list(query: PageQuery): Promise<CursorPage<Expense>> {
    const items = [...this.byId.values()].slice(0, query.limit);
    return Promise.resolve(makeCursorPage(items, null));
  }
}

/**
 * Fake PDP modeling the seeded acme.finance policy + the tenant guardrail:
 *  - DENY anything where resource.tenantId != principal.tenantId (guardrail);
 *  - for finance_manager: ALLOW read/approve when same department AND amount<10000;
 *  - DENY otherwise.
 */
@Injectable()
class FakePdp {
  public check(
    principal: PdpPrincipal,
    resource: PdpResource,
    actions: string[],
  ): Promise<PdpCheckResult> {
    const sameTenant = resource.attr.tenantId === principal.attr.tenantId;
    const sameDept = resource.attr.department === principal.attr.department;
    const amount = Number(resource.attr.amount);
    const isFinanceManager = principal.roles.includes('finance_manager');

    const results = actions.map((action) => {
      if (!sameTenant) {
        return { action, effect: 'DENY' as const, policy: 'expense_report', reason: 'cross-tenant' };
      }
      const allowed = isFinanceManager && sameDept && amount < 10000;
      const effect: 'ALLOW' | 'DENY' = allowed ? 'ALLOW' : 'DENY';
      return {
        action,
        effect,
        policy: 'expense_report/acme.finance',
        reason: allowed
          ? 'allowed by expense_report/acme.finance'
          : 'denied by expense_report/acme.finance',
      };
    });
    return Promise.resolve({ decisionId: `dec_fake_${resource.id}`, results });
  }
}

/** Fake PIP returning riya as a finance_manager in the finance department. */
@Injectable()
class FakePip {
  public resolve(userId: string, tenantId: string): Promise<EffectivePrincipal> {
    const isRiya = userId === 'riya';
    return Promise.resolve({
      id: userId,
      tenantId,
      roles: isRiya ? ['finance_manager'] : [],
      attr: isRiya ? { tenantId, department: 'finance' } : { tenantId },
    });
  }
}

/** Capturing audit sink so the test can assert every decision was recorded. */
@Injectable()
class CapturingAuditSink {
  public readonly records: DecisionAuditRecord[] = [];
  public record(record: DecisionAuditRecord): void {
    this.records.push(record);
  }
}

/** base64url JSON internal identity token (the IdentityContextMiddleware placeholder). */
function token(principal: { sub: string; tid: string }): string {
  const t: InternalIdentityToken = {
    sub: principal.sub,
    tid: principal.tid,
    actorId: principal.sub,
    sessionId: 'sess_e2e',
  };
  return Buffer.from(JSON.stringify(t), 'utf8').toString('base64url');
}

describe('Expense module (e2e, mocked PDP+PIP)', () => {
  let app: INestApplication;
  let repo: InMemoryExpenseRepository;
  let audit: CapturingAuditSink;

  const HEADER = 'x-internal-identity';

  beforeAll(async () => {
    // DB disabled so DatabaseModule boots without Postgres and RLS passes through.
    process.env.DB_ENABLED = 'false';
    process.env.NODE_ENV = 'test';

    repo = new InMemoryExpenseRepository();
    audit = new CapturingAuditSink();

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EXPENSE_REPOSITORY)
      .useValue(repo)
      .overrideProvider(CerbosPdpClient)
      .useClass(FakePdp)
      .overrideProvider(PIP_CLIENT)
      .useClass(FakePip)
      .overrideProvider(AUDIT_SINK)
      .useValue(audit)
      .compile();

    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(app.get(GlobalExceptionFilter));
    await app.init();

    const now = new Date('2026-06-01T00:00:00.000Z');
    repo.seed(
      Expense.create({
        id: 'exp_42',
        tenantId: ACME,
        amount: 8500,
        currency: 'USD',
        department: 'finance',
        ownerId: 'riya',
        description: 'dinner',
        scope: 'acme.finance',
        now,
      }),
    );
    repo.seed(
      Expense.create({
        id: 'exp_99',
        tenantId: ACME,
        amount: 25000,
        currency: 'USD',
        department: 'finance',
        ownerId: 'riya',
        description: 'offsite',
        scope: 'acme.finance',
        now,
      }),
    );
    repo.seed(
      Expense.create({
        id: 'exp_glx',
        tenantId: GLOBEX,
        amount: 4200,
        currency: 'USD',
        department: 'ops',
        ownerId: 'gframe',
        description: 'logistics',
        scope: 'globex',
        now,
      }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a request without the internal identity token (401 + envelope)', async () => {
    const res = await request(app.getHttpServer()).post('/v1/expenses/exp_42/approve').send({});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });

  it('CASE 1 — ALLOW: finance_manager approves an $8.5k same-dept expense (returns decisionId)', async () => {
    audit.records.length = 0;
    const res = await request(app.getHttpServer())
      .post('/v1/expenses/exp_42/approve')
      .set(HEADER, token({ sub: 'riya', tid: ACME }))
      .send({ comment: 'ok' });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('exp_42');
    expect(res.body.status).toBe('approved');
    expect(res.body.approvedBy).toBe('riya');
    expect(res.body.decisionId).toBe('dec_fake_exp_42');
    expect(res.headers['x-trace-id']).toBeDefined();
    // The ALLOW was audited.
    expect(audit.records.some((r) => r.effect === 'ALLOW' && r.resourceId === 'exp_42')).toBe(true);
  });

  it('CASE 2 — DENY: approving the $25k expense returns 403 with reason + decisionId', async () => {
    audit.records.length = 0;
    const res = await request(app.getHttpServer())
      .post('/v1/expenses/exp_99/approve')
      .set(HEADER, token({ sub: 'riya', tid: ACME }))
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
    expect(res.body.error.reason).toBe('denied by expense_report/acme.finance');
    expect(res.body.error.decisionId).toBe('dec_fake_exp_99');
    // The DENY was still audited.
    expect(audit.records.some((r) => r.effect === 'DENY' && r.resourceId === 'exp_99')).toBe(true);
  });

  it('CASE 3 — TENANT GUARDRAIL: an Acme principal approving a Globex expense is 403 (cross-tenant)', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/expenses/exp_glx/approve')
      .set(HEADER, token({ sub: 'riya', tid: ACME }))
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
    expect(res.body.error.reason).toBe('tenant isolation guardrail');
  });

  it('404: approving a non-existent expense is a not_found, never an allow', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/expenses/exp_missing/approve')
      .set(HEADER, token({ sub: 'riya', tid: ACME }))
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('authorization-aware list: returns ONLY the expenses the caller may read', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/expenses')
      .set(HEADER, token({ sub: 'riya', tid: ACME }));

    expect(res.status).toBe(200);
    const ids = (res.body.items as { id: string }[]).map((e) => e.id);
    // RLS layer (in-memory here returns all 3), then PDP read-filter:
    //   exp_42 ($8.5k same-dept) -> ALLOW; exp_99 ($25k) -> DENY (amount);
    //   exp_glx (Globex) -> DENY (cross-tenant guardrail in the fake PDP).
    expect(ids).toEqual(['exp_42']);
  });
});

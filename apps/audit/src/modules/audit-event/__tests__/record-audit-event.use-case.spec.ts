import { type Clock } from '@kernel/core';

import { type RecordAuditEventCommand } from '../application/dto/audit-event.commands';
import { RecordAuditEventUseCase } from '../application/use-cases/record-audit-event.use-case';
import { VerifyChainUseCase } from '../application/use-cases/verify-chain.use-case';
import { GENESIS_HASH } from '../domain/audit-event.entity';
import { DuplicateAuditEventError, InvalidAuditEventError } from '../domain/audit-event.errors';
import { InMemoryAuditEventRepository } from './in-memory-audit-event.repository';

/**
 * Unit test for the record-audit-event use-case. The repository PORT and CLOCK
 * port are exercised via an in-memory adapter, so this covers pure application
 * logic with no NestJS, no DB — focusing on the hash-chain integrity.
 */
describe('RecordAuditEventUseCase', () => {
  const fixedNow = new Date('2026-06-06T10:00:00.000Z');
  const clock: Clock = { now: () => fixedNow };
  const tenantId = 'aaaaaaaa-0000-4000-8000-000000000001';

  function makeCommand(overrides: Partial<RecordAuditEventCommand> = {}): RecordAuditEventCommand {
    return {
      tenantId,
      actor: 'riya',
      action: 'approve',
      decision: 'ALLOW',
      resourceKind: 'expense_report',
      resourceId: 'exp_1',
      reason: 'finance_manager same dept',
      decisionId: 'dec_1',
      traceId: 'trc_1',
      occurredAt: '2026-06-06T09:59:00.000Z',
      ...overrides,
    };
  }

  it('appends the first record linked to the genesis hash', async () => {
    const repo = new InMemoryAuditEventRepository();
    const useCase = new RecordAuditEventUseCase(repo, clock);

    const view = await useCase.execute(makeCommand());

    expect(view.seq).toBe(1);
    expect(view.prevHash).toBe(GENESIS_HASH);
    expect(view.recordHash).toMatch(/^[0-9a-f]{64}$/);
    expect(view.decision).toBe('ALLOW');
    expect(view.recordedAt).toBe(fixedNow.toISOString());
    expect(view.occurredAt).toBe('2026-06-06T09:59:00.000Z');
  });

  it('chains subsequent records: each prev_hash = the prior record_hash', async () => {
    const repo = new InMemoryAuditEventRepository();
    const useCase = new RecordAuditEventUseCase(repo, clock);

    const a = await useCase.execute(makeCommand({ resourceId: 'exp_1' }));
    const b = await useCase.execute(makeCommand({ resourceId: 'exp_2' }));
    const c = await useCase.execute(makeCommand({ resourceId: 'exp_3', decision: 'DENY' }));

    expect(b.prevHash).toBe(a.recordHash);
    expect(c.prevHash).toBe(b.recordHash);
    expect(new Set([a.recordHash, b.recordHash, c.recordHash]).size).toBe(3);
    expect([a.seq, b.seq, c.seq]).toEqual([1, 2, 3]);

    // The whole chain verifies clean.
    const verify = await new VerifyChainUseCase(repo).execute();
    expect(verify.valid).toBe(true);
    expect(verify.count).toBe(3);
    expect(verify.headHash).toBe(c.recordHash);
  });

  it('defaults occurredAt to the clock when `at` is absent', async () => {
    const repo = new InMemoryAuditEventRepository();
    const useCase = new RecordAuditEventUseCase(repo, clock);

    const view = await useCase.execute(makeCommand({ occurredAt: undefined }));

    expect(view.occurredAt).toBe(fixedNow.toISOString());
  });

  it('normalizes the decision case-insensitively', async () => {
    const repo = new InMemoryAuditEventRepository();
    const useCase = new RecordAuditEventUseCase(repo, clock);

    const view = await useCase.execute(makeCommand({ decision: 'deny' }));

    expect(view.decision).toBe('DENY');
  });

  it('rejects an unknown decision value (fail-closed)', async () => {
    const repo = new InMemoryAuditEventRepository();
    const useCase = new RecordAuditEventUseCase(repo, clock);

    await expect(useCase.execute(makeCommand({ decision: 'MAYBE' }))).rejects.toThrow();
  });

  it('rejects a malformed occurredAt', async () => {
    const repo = new InMemoryAuditEventRepository();
    const useCase = new RecordAuditEventUseCase(repo, clock);

    await expect(useCase.execute(makeCommand({ occurredAt: 'not-a-date' }))).rejects.toBeInstanceOf(
      InvalidAuditEventError,
    );
  });

  it('rejects a duplicate id (idempotency — one chain row per event)', async () => {
    const repo = new InMemoryAuditEventRepository();
    const useCase = new RecordAuditEventUseCase(repo, clock);
    const id = '11111111-1111-4111-8111-111111111111';

    await useCase.execute(makeCommand({ id }));
    await expect(useCase.execute(makeCommand({ id }))).rejects.toBeInstanceOf(
      DuplicateAuditEventError,
    );
    // The chain still has exactly one record.
    expect(repo.all()).toHaveLength(1);
  });

  it('rejects a non-UUID tenantId at the domain boundary', async () => {
    const repo = new InMemoryAuditEventRepository();
    const useCase = new RecordAuditEventUseCase(repo, clock);

    await expect(useCase.execute(makeCommand({ tenantId: 'acme' }))).rejects.toThrow();
  });
});

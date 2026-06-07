import { type Clock } from '@kernel/core';

import { RecordAuditEventUseCase } from '../application/use-cases/record-audit-event.use-case';
import { VerifyChainUseCase } from '../application/use-cases/verify-chain.use-case';
import { type AuditEvent, GENESIS_HASH } from '../domain/audit-event.entity';
import { InMemoryAuditEventRepository } from './in-memory-audit-event.repository';

/** Fetches the record at a given seq, failing the test loudly if it is missing. */
function requireSeq(repo: InMemoryAuditEventRepository, seq: number): AuditEvent {
  const found = repo.all().find((r) => r.seq === seq);
  if (!found) {
    throw new Error(`expected a record at seq ${String(seq)}`);
  }
  return found;
}

/**
 * Tamper-detection tests: the verifier must flag ANY post-hoc modification,
 * deletion, or reorder of a recorded event. This is the core compliance
 * guarantee (DESIGN §10 / App. C — "tampering detectable even by an insider").
 */
describe('VerifyChainUseCase (tamper detection)', () => {
  const clock: Clock = { now: () => new Date('2026-06-06T10:00:00.000Z') };
  const tenantId = 'aaaaaaaa-0000-4000-8000-000000000001';

  async function seedThree(
    repo: InMemoryAuditEventRepository,
  ): Promise<void> {
    const record = new RecordAuditEventUseCase(repo, clock);
    await record.execute({
      tenantId,
      actor: 'riya',
      action: 'approve',
      decision: 'ALLOW',
      resourceKind: 'expense_report',
      resourceId: 'exp_1',
    });
    await record.execute({
      tenantId,
      actor: 'sam',
      action: 'read',
      decision: 'ALLOW',
      resourceKind: 'expense_report',
      resourceId: 'exp_2',
    });
    await record.execute({
      tenantId,
      actor: 'mallory',
      action: 'approve',
      decision: 'DENY',
      resourceKind: 'expense_report',
      resourceId: 'exp_3',
    });
  }

  it('reports a valid, empty chain (genesis head)', async () => {
    const repo = new InMemoryAuditEventRepository();
    const result = await new VerifyChainUseCase(repo).execute();
    expect(result.valid).toBe(true);
    expect(result.count).toBe(0);
    expect(result.headHash).toBe(GENESIS_HASH);
    expect(result.brokenAt).toBeNull();
  });

  it('verifies an untampered chain', async () => {
    const repo = new InMemoryAuditEventRepository();
    await seedThree(repo);

    const result = await new VerifyChainUseCase(repo).execute();

    expect(result.valid).toBe(true);
    expect(result.count).toBe(3);
    expect(result.brokenAt).toBeNull();
  });

  it('detects content tampering (a field of a recorded event was edited)', async () => {
    const repo = new InMemoryAuditEventRepository();
    await seedThree(repo);

    // Flip record #2's decision from ALLOW to DENY WITHOUT recomputing its hash —
    // exactly what an attacker editing the DB row directly would produce.
    const target = requireSeq(repo, 2);
    repo.tamperInPlace(2, {
      id: target.id.toString(),
      tenantId: target.tenantId,
      actor: target.actor,
      action: target.action,
      decision: 'DENY', // tampered
      resourceKind: target.resourceKind,
      resourceId: target.resourceId,
      reason: target.reason,
      policy: target.policy,
      decisionId: target.decisionId,
      traceId: target.traceId,
      occurredAt: target.occurredAt,
      recordedAt: target.recordedAt,
      seq: target.seq,
      prevHash: target.prevHash,
      recordHash: target.recordHash, // stale hash — no longer matches content
    });

    const result = await new VerifyChainUseCase(repo).execute();

    expect(result.valid).toBe(false);
    expect(result.brokenAt?.seq).toBe(2);
    expect(result.brokenAt?.reason).toMatch(/record_hash/);
  });

  it('detects a deleted record (chain link breaks at the gap)', async () => {
    const repo = new InMemoryAuditEventRepository();
    await seedThree(repo);

    repo.deleteBySeq(2);

    const result = await new VerifyChainUseCase(repo).execute();

    expect(result.valid).toBe(false);
    // Record #3's prev_hash pointed at #2's hash, which is now gone -> link break.
    expect(result.brokenAt?.seq).toBe(3);
    expect(result.brokenAt?.reason).toMatch(/prev_hash/);
  });

  it('detects a re-pointed prev_hash (reorder/forgery of the link)', async () => {
    const repo = new InMemoryAuditEventRepository();
    await seedThree(repo);

    // Rewrite record #2's prev_hash to genesis (as if reinserted out of order).
    const target = requireSeq(repo, 2);
    repo.tamperInPlace(2, {
      id: target.id.toString(),
      tenantId: target.tenantId,
      actor: target.actor,
      action: target.action,
      decision: target.decision,
      resourceKind: target.resourceKind,
      resourceId: target.resourceId,
      reason: target.reason,
      policy: target.policy,
      decisionId: target.decisionId,
      traceId: target.traceId,
      occurredAt: target.occurredAt,
      recordedAt: target.recordedAt,
      seq: target.seq,
      prevHash: GENESIS_HASH, // wrong link
      recordHash: target.recordHash,
    });

    const result = await new VerifyChainUseCase(repo).execute();

    expect(result.valid).toBe(false);
    expect(result.brokenAt?.seq).toBe(2);
    expect(result.brokenAt?.reason).toMatch(/prev_hash/);
  });
});

import {
  type CanonicalAuditEvent,
  canonicalizeEvent,
  computeRecordHash,
  GENESIS_HASH,
} from '../domain/hash-chain';

/**
 * Unit tests for the PURE hash-chain primitives. These pin the tamper-evidence
 * properties the whole audit guarantee rests on: determinism, sensitivity to any
 * field change, and chaining via prev_hash.
 */
describe('hash-chain', () => {
  const base: CanonicalAuditEvent = {
    id: '11111111-1111-4111-8111-111111111111',
    tenantId: 'aaaaaaaa-0000-4000-8000-000000000001',
    actor: 'riya',
    action: 'approve',
    decision: 'ALLOW',
    resourceKind: 'expense_report',
    resourceId: 'exp_1',
    reason: 'finance_manager same dept amount<10000',
    policy: 'expense_report/acme.finance',
    decisionId: 'dec_1',
    traceId: 'trc_1',
    occurredAt: '2026-06-06T10:00:00.000Z',
  };

  it('GENESIS_HASH is 64 hex zeros', () => {
    expect(GENESIS_HASH).toBe('0'.repeat(64));
    expect(GENESIS_HASH).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces a 64-char hex sha256 digest', () => {
    const hash = computeRecordHash(GENESIS_HASH, base);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic — same input, same hash', () => {
    expect(computeRecordHash(GENESIS_HASH, base)).toBe(computeRecordHash(GENESIS_HASH, base));
  });

  it('canonicalization is independent of caller key order', () => {
    // Build an object with keys in a DIFFERENT insertion order than canonical.
    const reordered: CanonicalAuditEvent = {
      occurredAt: base.occurredAt,
      traceId: base.traceId,
      decisionId: base.decisionId,
      policy: base.policy,
      reason: base.reason,
      resourceId: base.resourceId,
      resourceKind: base.resourceKind,
      decision: base.decision,
      action: base.action,
      actor: base.actor,
      tenantId: base.tenantId,
      id: base.id,
    };
    expect(canonicalizeEvent(reordered)).toBe(canonicalizeEvent(base));
    expect(computeRecordHash(GENESIS_HASH, reordered)).toBe(computeRecordHash(GENESIS_HASH, base));
  });

  it('changes the hash when ANY signed field changes (tamper sensitivity)', () => {
    const original = computeRecordHash(GENESIS_HASH, base);
    const mutations: Partial<CanonicalAuditEvent>[] = [
      { actor: 'mallory' },
      { action: 'delete' },
      { decision: 'DENY' },
      { resourceId: 'exp_2' },
      { reason: 'tampered' },
      { policy: 'expense_report/acme' },
      { decisionId: 'dec_2' },
      { traceId: 'trc_2' },
      { occurredAt: '2026-06-06T10:00:00.001Z' },
      { tenantId: 'bbbbbbbb-0000-4000-8000-000000000002' },
    ];
    for (const mutation of mutations) {
      expect(computeRecordHash(GENESIS_HASH, { ...base, ...mutation })).not.toBe(original);
    }
  });

  it('chains: changing prev_hash changes the record hash (link sensitivity)', () => {
    const h1 = computeRecordHash(GENESIS_HASH, base);
    const h2 = computeRecordHash(h1, base);
    expect(h2).not.toBe(h1);
  });

  it('distinguishes null from empty-string in optional fields', () => {
    const withNull = computeRecordHash(GENESIS_HASH, { ...base, reason: null });
    const withEmpty = computeRecordHash(GENESIS_HASH, { ...base, reason: '' });
    expect(withNull).not.toBe(withEmpty);
  });
});

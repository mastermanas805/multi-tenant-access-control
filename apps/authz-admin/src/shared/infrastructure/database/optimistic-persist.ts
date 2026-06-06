import { type EntityManager, type ObjectLiteral, type EntityTarget } from 'typeorm';

import { ConflictError } from '@kernel/core';

/**
 * Atomic optimistic-concurrency guard for aggregate persistence (DESIGN §8.1).
 *
 * The previous implementation compared `expectedVersion` to the in-memory version
 * read earlier in the SAME READ COMMITTED transaction and then issued a plain
 * UPSERT-by-PK with NO version predicate — a TOCTOU check, not a concurrency
 * control. Two requests could both read version=N, both pass the in-memory check,
 * and both write: the later commit silently overwrote the earlier (lost update).
 *
 * This helper makes the check ATOMIC at the database. The aggregate has already
 * bumped its version in memory (N -> N+1), so for an existing row the DB must
 * still be at `newVersion - 1`. We issue a single compare-and-set:
 *
 *   UPDATE T SET version = :newVersion WHERE id = :id AND version = :previous
 *
 * evaluated under the row lock the UPDATE acquires, and inspect the affected count:
 *   - affected === 1 -> the CAS won; the caller may now write the full row state
 *       (children, timestamps) via the normal `.save()` while still holding the
 *       lock in this transaction, so no concurrent writer can interleave.
 *   - affected === 0 + the row exists -> a concurrent writer already advanced the
 *       version: raise ConflictError (-> 409) instead of clobbering it.
 *   - affected === 0 + no such row -> nothing to guard yet; it is a fresh INSERT.
 *
 * Returns true when the caller should proceed to persist the full aggregate
 * (CAS won, or it is a brand-new INSERT). Throws ConflictError on a stale write.
 */
export async function guardOptimisticLock<TEntity extends ObjectLiteral>(
  manager: EntityManager,
  target: EntityTarget<TEntity>,
  id: string,
  newVersion: number,
): Promise<void> {
  // A freshly-created aggregate is at version 1 and has no prior row to guard.
  if (newVersion <= 1) {
    return;
  }

  const previousVersion = newVersion - 1;
  const repository = manager.getRepository(target);

  const result = await repository
    .createQueryBuilder()
    .update()
    .set({ version: newVersion } as never)
    .where('id = :id AND version = :previousVersion', { id, previousVersion })
    .execute();

  if (result.affected === 1) {
    return; // CAS won — safe to write the full row in the same transaction.
  }

  // 0 rows matched: distinguish a not-yet-inserted row from a stale write.
  const exists = await repository.createQueryBuilder('e').where('e.id = :id', { id }).getExists();
  if (exists) {
    throw new ConflictError('Resource was modified by another request', 'version_mismatch');
  }
  // No row yet -> a new aggregate that happens to carry version > 1 is not expected,
  // but treating it as an INSERT is safe (the caller's save will create it).
}

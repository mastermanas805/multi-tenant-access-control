import { Inject, Injectable } from '@nestjs/common';

import { GENESIS_HASH } from '../../domain/audit-event.entity';
import {
  type AuditEventRepository,
  AUDIT_EVENT_REPOSITORY,
} from '../../domain/audit-event.repository.port';
import { type ChainVerificationView } from '../dto/audit-event.view';

/**
 * Replays the entire hash chain from genesis to head to detect tampering
 * (DESIGN §10 / App. C). For each record in `seq` order it checks two things:
 *
 *   1. LINK: the record's stored `prevHash` equals the previous record's
 *      `recordHash` (genesis links to GENESIS_HASH) — catches deletion/reorder.
 *   2. CONTENT: recomputing `sha256(prevHash || canonical(event))` from the
 *      record's own fields reproduces the stored `recordHash` — catches any edit
 *      to a recorded field.
 *
 * The first failing record is reported. This is what powers an integrity check /
 * the periodic external anchoring of the chain head.
 */
@Injectable()
export class VerifyChainUseCase {
  constructor(@Inject(AUDIT_EVENT_REPOSITORY) private readonly events: AuditEventRepository) {}

  public async execute(): Promise<ChainVerificationView> {
    const records = await this.events.listAllInChainOrder();

    let prevHash = GENESIS_HASH;
    for (const record of records) {
      if (record.prevHash !== prevHash) {
        return {
          valid: false,
          count: records.length,
          headHash: prevHash,
          brokenAt: {
            seq: record.seq,
            reason: 'prev_hash does not match the previous record (deletion or reorder)',
          },
        };
      }

      const recomputed = record.recomputeHash(prevHash);
      if (recomputed !== record.recordHash) {
        return {
          valid: false,
          count: records.length,
          headHash: prevHash,
          brokenAt: {
            seq: record.seq,
            reason: 'record_hash does not match recomputed hash (record content was modified)',
          },
        };
      }

      prevHash = record.recordHash;
    }

    return {
      valid: true,
      count: records.length,
      headHash: prevHash,
      brokenAt: null,
    };
  }
}

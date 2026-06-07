import { Module } from '@nestjs/common';

import { ListAuditEventsUseCase } from './application/use-cases/list-audit-events.use-case';
import { RecordAuditEventUseCase } from './application/use-cases/record-audit-event.use-case';
import { VerifyChainUseCase } from './application/use-cases/verify-chain.use-case';
import { AUDIT_EVENT_REPOSITORY } from './domain/audit-event.repository.port';
import { TypeOrmAuditEventRepository } from './infrastructure/typeorm-audit-event.repository';
import { AuditEventController } from './presentation/audit-event.controller';

/**
 * Wires the AuditEvent feature module:
 *   - controller (presentation),
 *   - use-cases (application),
 *   - the repository PORT token -> its TypeORM adapter (infrastructure).
 *
 * The CLOCK port comes from the global SharedModule; DATA_SOURCE from the global
 * DatabaseModule. Mirrors the authz-admin feature-module pattern.
 */
@Module({
  controllers: [AuditEventController],
  providers: [
    RecordAuditEventUseCase,
    ListAuditEventsUseCase,
    VerifyChainUseCase,
    { provide: AUDIT_EVENT_REPOSITORY, useClass: TypeOrmAuditEventRepository },
  ],
  exports: [AUDIT_EVENT_REPOSITORY],
})
export class AuditEventModule {}

import { Module } from '@nestjs/common';

import { ConfigService } from '../../config/config.service';
import { POLICY_REPOSITORY } from './domain/policy.repository.port';
import { POLICY_PUBLISHER } from './application/ports/policy-publisher.port';
import { ActivatePolicyUseCase } from './application/use-cases/activate-policy.use-case';
import { GetPolicyUseCase } from './application/use-cases/get-policy.use-case';
import { ListPoliciesUseCase } from './application/use-cases/list-policies.use-case';
import { PublishPolicyUseCase } from './application/use-cases/publish-policy.use-case';
import { RollbackPolicyUseCase } from './application/use-cases/rollback-policy.use-case';
import { FsCerbosPolicyPublisher } from './infrastructure/publishing/fs-cerbos-policy.publisher';
import { NoopPolicyPublisher } from './infrastructure/publishing/noop-policy.publisher';
import { TypeOrmPolicyRepository } from './infrastructure/typeorm-policy.repository';
import { PolicyController } from './presentation/policy.controller';

/**
 * Wires the Policy feature module:
 *   - controller (presentation),
 *   - use-cases (application),
 *   - the repository PORT token -> its TypeORM adapter (infrastructure),
 *   - the publisher PORT token -> the FS Cerbos publisher (or a no-op when the
 *     CERBOS_PUBLISH_ENABLED toggle is off, so tests/CI need no disk or PDP).
 *
 * Binding POLICY_PUBLISHER via a factory keeps the toggle a single composition
 * decision: publish/activate/rollback use-cases depend only on the port, so the
 * dynamic PDP publishing (DESIGN §3.4) is transparent to them.
 *
 * The CLOCK port and TenantContextGuard come from the global SharedModule; the
 * DATA_SOURCE and TenantContextService come from the global DatabaseModule.
 * This is the EXACT pattern the Tenant reference module establishes.
 */
@Module({
  controllers: [PolicyController],
  providers: [
    PublishPolicyUseCase,
    ActivatePolicyUseCase,
    RollbackPolicyUseCase,
    GetPolicyUseCase,
    ListPoliciesUseCase,
    { provide: POLICY_REPOSITORY, useClass: TypeOrmPolicyRepository },
    FsCerbosPolicyPublisher,
    NoopPolicyPublisher,
    {
      provide: POLICY_PUBLISHER,
      inject: [ConfigService, FsCerbosPolicyPublisher, NoopPolicyPublisher],
      useFactory: (
        config: ConfigService,
        fs: FsCerbosPolicyPublisher,
        noop: NoopPolicyPublisher,
      ) => (config.values.CERBOS_PUBLISH_ENABLED ? fs : noop),
    },
  ],
  exports: [POLICY_REPOSITORY],
})
export class PolicyModule {}

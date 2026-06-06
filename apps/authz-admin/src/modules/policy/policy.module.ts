import { Module } from '@nestjs/common';

import { POLICY_REPOSITORY } from './domain/policy.repository.port';
import { ActivatePolicyUseCase } from './application/use-cases/activate-policy.use-case';
import { GetPolicyUseCase } from './application/use-cases/get-policy.use-case';
import { ListPoliciesUseCase } from './application/use-cases/list-policies.use-case';
import { PublishPolicyUseCase } from './application/use-cases/publish-policy.use-case';
import { RollbackPolicyUseCase } from './application/use-cases/rollback-policy.use-case';
import { TypeOrmPolicyRepository } from './infrastructure/typeorm-policy.repository';
import { PolicyController } from './presentation/policy.controller';

/**
 * Wires the Policy feature module:
 *   - controller (presentation),
 *   - use-cases (application),
 *   - the repository PORT token -> its TypeORM adapter (infrastructure).
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
  ],
  exports: [POLICY_REPOSITORY],
})
export class PolicyModule {}

import { Inject, Injectable } from '@nestjs/common';

import { ConflictError, type Clock, CLOCK } from '@kernel/core';

import { PolicyNotFoundError } from '../../domain/policy.errors';
import { type PolicyRepository, POLICY_REPOSITORY } from '../../domain/policy.repository.port';
import { PolicyId } from '../../domain/value-objects/policy-id.vo';
import { type ActivatePolicyCommand } from '../dto/policy.commands';
import { type PolicyView, toPolicyView } from '../dto/policy.view';

/**
 * Activates a staged policy version. Honors optimistic concurrency (DESIGN §8.1):
 * when the caller supplies an expected version (from the `If-Match` ETag) it must
 * match the loaded aggregate, else a ConflictError (-> 409) is raised.
 */
@Injectable()
export class ActivatePolicyUseCase {
  constructor(
    @Inject(POLICY_REPOSITORY) private readonly policies: PolicyRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public async execute(command: ActivatePolicyCommand): Promise<PolicyView> {
    const id = PolicyId.fromString(command.policyId);
    const policy = await this.policies.findById(id);
    if (!policy) {
      throw new PolicyNotFoundError(command.policyId);
    }

    if (command.expectedVersion !== undefined && command.expectedVersion !== policy.version) {
      throw new ConflictError('Policy was modified by another request', 'version_mismatch');
    }

    policy.activate(this.clock.now());
    await this.policies.save(policy);

    return toPolicyView(policy);
  }
}

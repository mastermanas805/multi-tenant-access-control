import { Inject, Injectable } from '@nestjs/common';

import { PolicyNotFoundError } from '../../domain/policy.errors';
import { type PolicyRepository, POLICY_REPOSITORY } from '../../domain/policy.repository.port';
import { PolicyId } from '../../domain/value-objects/policy-id.vo';
import { type GetPolicyQuery } from '../dto/policy.commands';
import { type PolicyView, toPolicyView } from '../dto/policy.view';

/** Loads a single policy by id, or raises a domain NotFound (mapped to 404). */
@Injectable()
export class GetPolicyUseCase {
  constructor(@Inject(POLICY_REPOSITORY) private readonly policies: PolicyRepository) {}

  public async execute(query: GetPolicyQuery): Promise<PolicyView> {
    const id = PolicyId.fromString(query.policyId);
    const policy = await this.policies.findById(id);
    if (!policy) {
      throw new PolicyNotFoundError(query.policyId);
    }
    return toPolicyView(policy);
  }
}

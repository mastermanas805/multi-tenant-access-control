import { Inject, Injectable } from '@nestjs/common';

import { PageQuery } from '@kernel/core';

import { type PolicyRepository, POLICY_REPOSITORY } from '../../domain/policy.repository.port';
import { type ListPoliciesQuery } from '../dto/policy.commands';
import { type PolicyPageView, toPolicyPageView } from '../dto/policy.view';

/** Cursor-paginated listing of policies. */
@Injectable()
export class ListPoliciesUseCase {
  constructor(@Inject(POLICY_REPOSITORY) private readonly policies: PolicyRepository) {}

  public async execute(query: ListPoliciesQuery): Promise<PolicyPageView> {
    const page = PageQuery.from({ limit: query.limit, cursor: query.cursor });
    const result = await this.policies.list(page);
    return toPolicyPageView(result);
  }
}

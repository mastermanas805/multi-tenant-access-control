import { type CursorPage } from '@kernel/core';

import { type Policy } from '../../domain/policy.entity';

/**
 * A read-model view of a Policy returned by use-cases. Decouples the API shape
 * from the aggregate so internal refactors don't leak into the contract.
 */
export interface PolicyView {
  id: string;
  tenantId: string;
  scope: string;
  rule: Record<string, unknown>;
  status: string;
  version: number;
  effectiveDate: string;
  createdAt: string;
  updatedAt: string;
}

/** Maps a Policy aggregate to its view representation. */
export function toPolicyView(policy: Policy): PolicyView {
  return {
    id: policy.id.toString(),
    tenantId: policy.tenantId,
    scope: policy.scope.toString(),
    rule: policy.rule,
    status: policy.status,
    version: policy.version,
    effectiveDate: policy.effectiveDate.toISOString(),
    createdAt: policy.createdAt.toISOString(),
    updatedAt: policy.updatedAt.toISOString(),
  };
}

/** A page of policy views (mirrors the kernel CursorPage shape). */
export interface PolicyPageView {
  items: PolicyView[];
  nextCursor: string | null;
  hasMore: boolean;
}

export function toPolicyPageView(page: CursorPage<Policy>): PolicyPageView {
  return {
    items: page.items.map(toPolicyView),
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  };
}

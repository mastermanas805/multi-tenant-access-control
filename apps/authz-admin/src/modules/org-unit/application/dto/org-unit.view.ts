import { type CursorPage } from '@kernel/core';

import { type OrgUnit } from '../../domain/org-unit.entity';

/**
 * A read-model view of an OrgUnit returned by use-cases. Decouples the API shape
 * from the aggregate so internal refactors don't leak into the contract.
 */
export interface OrgUnitView {
  id: string;
  tenantId: string;
  parentId: string | null;
  path: string;
  name: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** Maps an OrgUnit aggregate to its view representation. */
export function toOrgUnitView(orgUnit: OrgUnit): OrgUnitView {
  return {
    id: orgUnit.id.toString(),
    tenantId: orgUnit.tenantId,
    parentId: orgUnit.parentId,
    path: orgUnit.path.toString(),
    name: orgUnit.name,
    version: orgUnit.version,
    createdAt: orgUnit.createdAt.toISOString(),
    updatedAt: orgUnit.updatedAt.toISOString(),
  };
}

/** A page of org-unit views (mirrors the kernel CursorPage shape). */
export interface OrgUnitPageView {
  items: OrgUnitView[];
  nextCursor: string | null;
  hasMore: boolean;
}

export function toOrgUnitPageView(page: CursorPage<OrgUnit>): OrgUnitPageView {
  return {
    items: page.items.map(toOrgUnitView),
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  };
}

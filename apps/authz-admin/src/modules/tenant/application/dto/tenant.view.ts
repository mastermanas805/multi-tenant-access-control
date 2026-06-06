import { type CursorPage } from '@kernel/core';

import { type Tenant } from '../../domain/tenant.entity';

/**
 * A read-model view of a Tenant returned by use-cases. Decouples the API shape
 * from the aggregate so internal refactors don't leak into the contract.
 */
export interface TenantView {
  id: string;
  name: string;
  slug: string;
  status: string;
  isolationTier: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** Maps a Tenant aggregate to its view representation. */
export function toTenantView(tenant: Tenant): TenantView {
  return {
    id: tenant.id.toString(),
    name: tenant.name,
    slug: tenant.slug,
    status: tenant.status,
    isolationTier: tenant.isolationTier.toString(),
    version: tenant.version,
    createdAt: tenant.createdAt.toISOString(),
    updatedAt: tenant.updatedAt.toISOString(),
  };
}

/** A page of tenant views (mirrors the kernel CursorPage shape). */
export interface TenantPageView {
  items: TenantView[];
  nextCursor: string | null;
  hasMore: boolean;
}

export function toTenantPageView(page: CursorPage<Tenant>): TenantPageView {
  return {
    items: page.items.map(toTenantView),
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  };
}

import { type CursorPage } from '@kernel/core';

import { type Role } from '../../domain/role.entity';

/**
 * A read-model view of a Role returned by use-cases. Decouples the API shape
 * from the aggregate so internal refactors don't leak into the contract.
 */
export interface RoleView {
  id: string;
  tenantId: string;
  key: string;
  scope: string;
  description: string;
  permissions: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** Maps a Role aggregate to its view representation. */
export function toRoleView(role: Role): RoleView {
  return {
    id: role.id.toString(),
    tenantId: role.tenantId,
    key: role.key,
    scope: role.scope,
    description: role.description,
    permissions: role.permissions,
    version: role.version,
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString(),
  };
}

/** A page of role views (mirrors the kernel CursorPage shape). */
export interface RolePageView {
  items: RoleView[];
  nextCursor: string | null;
  hasMore: boolean;
}

export function toRolePageView(page: CursorPage<Role>): RolePageView {
  return {
    items: page.items.map(toRoleView),
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  };
}

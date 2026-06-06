import { type CursorPage } from '@kernel/core';

import { type Permission } from '../../domain/permission.entity';

/**
 * A read-model view of a Permission returned by use-cases. Decouples the API
 * shape from the aggregate so internal refactors don't leak into the contract.
 */
export interface PermissionView {
  id: string;
  key: string;
  description: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** Maps a Permission aggregate to its view representation. */
export function toPermissionView(permission: Permission): PermissionView {
  return {
    id: permission.id.toString(),
    key: permission.key.toString(),
    description: permission.description,
    version: permission.version,
    createdAt: permission.createdAt.toISOString(),
    updatedAt: permission.updatedAt.toISOString(),
  };
}

/** A page of permission views (mirrors the kernel CursorPage shape). */
export interface PermissionPageView {
  items: PermissionView[];
  nextCursor: string | null;
  hasMore: boolean;
}

export function toPermissionPageView(page: CursorPage<Permission>): PermissionPageView {
  return {
    items: page.items.map(toPermissionView),
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  };
}

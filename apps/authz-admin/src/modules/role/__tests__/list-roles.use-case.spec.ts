import { randomUUID } from 'node:crypto';

import { makeCursorPage } from '@kernel/core';

import { ListRolesUseCase } from '../application/use-cases/list-roles.use-case';
import { Role } from '../domain/role.entity';
import { type RoleRepository } from '../domain/role.repository.port';

/** Unit test for the list-roles use-case (mocked repository PORT). */
describe('ListRolesUseCase', () => {
  const fixedNow = new Date('2026-06-06T10:00:00.000Z');
  const tenantId = randomUUID();

  function makeRepo(overrides: Partial<RoleRepository> = {}): RoleRepository {
    return {
      save: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn().mockResolvedValue(null),
      findByKey: jest.fn().mockResolvedValue(null),
      list: jest.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
      ...overrides,
    };
  }

  it('clamps the limit and maps the page to views', async () => {
    const role = Role.create({ tenantId, key: 'viewer', scope: 'acme', now: fixedNow });
    const list = jest.fn().mockResolvedValue(makeCursorPage([role], null));
    const repo = makeRepo({ list });
    const useCase = new ListRolesUseCase(repo);

    const view = await useCase.execute({ limit: 5000 });

    expect(view.items).toHaveLength(1);
    expect(view.items.at(0)?.key).toBe('viewer');
    expect(view.hasMore).toBe(false);
    // limit clamped to MAX_PAGE_LIMIT (100) by PageQuery.from.
    const page = list.mock.calls[0][0] as { limit: number };
    expect(page.limit).toBe(100);
  });

  it('returns an empty page when there are no roles', async () => {
    const repo = makeRepo();
    const useCase = new ListRolesUseCase(repo);

    const view = await useCase.execute({});

    expect(view.items).toEqual([]);
    expect(view.nextCursor).toBeNull();
  });
});

import { makeCursorPage } from '@kernel/core';

import { ListPermissionsUseCase } from '../application/use-cases/list-permissions.use-case';
import { Permission } from '../domain/permission.entity';
import { type PermissionRepository } from '../domain/permission.repository.port';

/** Unit test for the list-permissions use-case (repository PORT mocked). */
describe('ListPermissionsUseCase', () => {
  const fixedNow = new Date('2026-06-06T10:00:00.000Z');

  function makeRepo(overrides: Partial<PermissionRepository> = {}): PermissionRepository {
    return {
      save: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn().mockResolvedValue(null),
      findByKey: jest.fn().mockResolvedValue(null),
      list: jest.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
      ...overrides,
    };
  }

  it('maps the repository page into a page view', async () => {
    const permission = Permission.create({
      key: 'expense:report:read',
      description: 'Read an expense report',
      now: fixedNow,
    });
    const repo = makeRepo({
      list: jest.fn().mockResolvedValue(makeCursorPage([permission], 'next-cursor')),
    });
    const useCase = new ListPermissionsUseCase(repo);

    const view = await useCase.execute({ limit: 10 });

    expect(view.items).toHaveLength(1);
    expect(view.items.at(0)?.key).toBe('expense:report:read');
    expect(view.nextCursor).toBe('next-cursor');
    expect(view.hasMore).toBe(true);
  });

  it('clamps the page query and forwards it to the repository', async () => {
    const list = jest.fn().mockResolvedValue(makeCursorPage([], null));
    const repo = makeRepo({ list });
    const useCase = new ListPermissionsUseCase(repo);

    const view = await useCase.execute({ limit: 9999 });

    expect(list).toHaveBeenCalledTimes(1);
    const passedQuery = list.mock.calls[0][0] as { limit: number };
    expect(passedQuery.limit).toBe(100); // clamped to MAX_PAGE_LIMIT
    expect(view.items).toHaveLength(0);
  });
});

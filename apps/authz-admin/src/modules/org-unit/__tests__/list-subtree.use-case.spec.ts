import { randomUUID } from 'node:crypto';

import { makeCursorPage } from '@kernel/core';

import { ListSubtreeUseCase } from '../application/use-cases/list-subtree.use-case';
import { OrgUnit } from '../domain/org-unit.entity';
import { type OrgUnitRepository } from '../domain/org-unit.repository.port';

/** Unit test for the list-subtree use-case (repository PORT mocked). */
describe('ListSubtreeUseCase', () => {
  const fixedNow = new Date('2026-06-06T10:00:00.000Z');
  const tenantId = randomUUID();

  function makeRepo(overrides: Partial<OrgUnitRepository> = {}): OrgUnitRepository {
    return {
      save: jest.fn().mockResolvedValue(undefined),
      saveMany: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn().mockResolvedValue(null),
      findByPath: jest.fn().mockResolvedValue(null),
      listSubtree: jest.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
      findDescendants: jest.fn().mockResolvedValue([]),
      ...overrides,
    };
  }

  it('maps the repository subtree page into a view page', async () => {
    const root = OrgUnit.createRoot({ tenantId, name: 'Acme', segment: 'acme', now: fixedNow });
    const child = OrgUnit.createChild({
      tenantId,
      name: 'Finance',
      segment: 'finance',
      parentId: root.id.toString(),
      parentPath: root.path,
      now: fixedNow,
    });
    const listSubtree = jest.fn().mockResolvedValue(makeCursorPage([root, child], null));
    const useCase = new ListSubtreeUseCase(makeRepo({ listSubtree }));

    const view = await useCase.execute({ rootPath: 'acme' });

    expect(view.items.map((i) => i.path)).toEqual(['acme', 'acme.finance']);
    expect(view.hasMore).toBe(false);
    expect(listSubtree).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid root path at the boundary', async () => {
    const useCase = new ListSubtreeUseCase(makeRepo());

    await expect(useCase.execute({ rootPath: 'Not Valid' })).rejects.toThrow();
  });
});

import { randomUUID } from 'node:crypto';

import { GetOrgUnitUseCase } from '../application/use-cases/get-org-unit.use-case';
import { OrgUnit } from '../domain/org-unit.entity';
import { OrgUnitNotFoundError } from '../domain/org-unit.errors';
import { type OrgUnitRepository } from '../domain/org-unit.repository.port';

/** Unit test for the get-org-unit use-case (repository PORT mocked). */
describe('GetOrgUnitUseCase', () => {
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

  it('returns the view for an existing org-unit', async () => {
    const node = OrgUnit.createRoot({ tenantId, name: 'Acme', segment: 'acme', now: fixedNow });
    const repo = makeRepo({ findById: jest.fn().mockResolvedValue(node) });
    const useCase = new GetOrgUnitUseCase(repo);

    const view = await useCase.execute({ orgUnitId: node.id.toString() });

    expect(view.id).toBe(node.id.toString());
    expect(view.path).toBe('acme');
  });

  it('throws OrgUnitNotFoundError when absent (-> 404)', async () => {
    const repo = makeRepo({ findById: jest.fn().mockResolvedValue(null) });
    const useCase = new GetOrgUnitUseCase(repo);

    await expect(useCase.execute({ orgUnitId: randomUUID() })).rejects.toBeInstanceOf(
      OrgUnitNotFoundError,
    );
  });
});

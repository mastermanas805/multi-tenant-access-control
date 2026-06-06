import { randomUUID } from 'node:crypto';

import { type Clock } from '@kernel/core';

import { type TenantContextService } from '../../../shared/infrastructure/database/tenant-context';
import { CreateOrgUnitUseCase } from '../application/use-cases/create-org-unit.use-case';
import { type CreateOrgUnitCommand } from '../application/dto/org-unit.commands';
import { OrgUnit } from '../domain/org-unit.entity';
import { OrgUnitNotFoundError, OrgUnitPathTakenError } from '../domain/org-unit.errors';
import { type OrgUnitRepository } from '../domain/org-unit.repository.port';

/**
 * Unit test for the create-org-unit use-case. The repository PORT, CLOCK, and
 * TenantContextService are mocked, so this exercises pure application logic with
 * no NestJS, no DB. Mirrors the Tenant unit-test shape.
 */
describe('CreateOrgUnitUseCase', () => {
  const fixedNow = new Date('2026-06-06T10:00:00.000Z');
  const clock: Clock = { now: () => fixedNow };
  const tenantId = randomUUID();
  const tenantContext = { getTenantId: () => tenantId } as unknown as TenantContextService;

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

  const rootCommand: CreateOrgUnitCommand = { segment: 'acme', name: 'Acme' };

  it('creates a root node whose path is the single segment', async () => {
    const repo = makeRepo();
    const useCase = new CreateOrgUnitUseCase(repo, clock, tenantContext);

    const view = await useCase.execute(rootCommand);

    expect(view.path).toBe('acme');
    expect(view.parentId).toBeNull();
    expect(view.tenantId).toBe(tenantId);
    expect(view.version).toBe(1);
    expect(view.createdAt).toBe(fixedNow.toISOString());
    expect(repo.save).toHaveBeenCalledTimes(1);
    const saved = (repo.save as jest.Mock).mock.calls[0][0] as OrgUnit;
    expect(saved).toBeInstanceOf(OrgUnit);
  });

  it('derives a child path from the parent', async () => {
    const parent = OrgUnit.createRoot({ tenantId, name: 'Acme', segment: 'acme', now: fixedNow });
    const repo = makeRepo({ findById: jest.fn().mockResolvedValue(parent) });
    const useCase = new CreateOrgUnitUseCase(repo, clock, tenantContext);

    const view = await useCase.execute({
      segment: 'finance',
      name: 'Finance',
      parentId: parent.id.toString(),
    });

    expect(view.path).toBe('acme.finance');
    expect(view.parentId).toBe(parent.id.toString());
  });

  it('rejects a missing parent with OrgUnitNotFoundError (-> 404)', async () => {
    const repo = makeRepo({ findById: jest.fn().mockResolvedValue(null) });
    const useCase = new CreateOrgUnitUseCase(repo, clock, tenantContext);

    await expect(
      useCase.execute({ segment: 'finance', name: 'Finance', parentId: randomUUID() }),
    ).rejects.toBeInstanceOf(OrgUnitNotFoundError);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('rejects a duplicate path with OrgUnitPathTakenError (-> 409)', async () => {
    const existing = OrgUnit.createRoot({
      tenantId,
      name: 'Acme',
      segment: 'acme',
      now: fixedNow,
    });
    const repo = makeRepo({ findByPath: jest.fn().mockResolvedValue(existing) });
    const useCase = new CreateOrgUnitUseCase(repo, clock, tenantContext);

    await expect(useCase.execute(rootCommand)).rejects.toBeInstanceOf(OrgUnitPathTakenError);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('rejects an invalid (non-kebab) segment at the domain boundary', async () => {
    const repo = makeRepo();
    const useCase = new CreateOrgUnitUseCase(repo, clock, tenantContext);

    await expect(useCase.execute({ segment: 'Not Valid', name: 'Bad' })).rejects.toThrow();
    expect(repo.save).not.toHaveBeenCalled();
  });
});

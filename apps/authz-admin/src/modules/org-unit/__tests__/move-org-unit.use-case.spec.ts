import { randomUUID } from 'node:crypto';

import {
  ConflictError,
  type Clock,
  type DomainEvent,
  type IDomainEventDispatcher,
} from '@kernel/core';

import { MoveOrgUnitUseCase } from '../application/use-cases/move-org-unit.use-case';
import { OrgUnit } from '../domain/org-unit.entity';
import { OrgUnitMovedEvent } from '../domain/org-unit.events';
import { OrgUnitCycleError, OrgUnitNotFoundError } from '../domain/org-unit.errors';
import { type OrgUnitRepository } from '../domain/org-unit.repository.port';

/**
 * Unit test for the move-org-unit use-case. Exercises the reparent + subtree
 * path-rewrite orchestration, cycle detection, and optimistic concurrency — all
 * against a mocked repository PORT (no NestJS, no DB).
 */
describe('MoveOrgUnitUseCase', () => {
  const fixedNow = new Date('2026-06-07T10:00:00.000Z');
  const clock: Clock = { now: () => fixedNow };
  const tenantId = randomUUID();

  function makeDispatcher(): IDomainEventDispatcher {
    return { dispatch: jest.fn().mockResolvedValue(undefined) };
  }

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

  // Build a small tree: acme > finance (the node) > emea (a descendant), and a
  // separate target root "corp" under which finance will be re-parented.
  function buildTree(): {
    finance: OrgUnit;
    emea: OrgUnit;
    corp: OrgUnit;
  } {
    const acme = OrgUnit.createRoot({ tenantId, name: 'Acme', segment: 'acme', now: fixedNow });
    const finance = OrgUnit.createChild({
      tenantId,
      name: 'Finance',
      segment: 'finance',
      parentId: acme.id.toString(),
      parentPath: acme.path,
      now: fixedNow,
    });
    const emea = OrgUnit.createChild({
      tenantId,
      name: 'EMEA',
      segment: 'emea',
      parentId: finance.id.toString(),
      parentPath: finance.path,
      now: fixedNow,
    });
    const corp = OrgUnit.createRoot({ tenantId, name: 'Corp', segment: 'corp', now: fixedNow });
    return { finance, emea, corp };
  }

  it('re-parents the node and rewrites the whole subtree path in one save', async () => {
    const { finance, emea, corp } = buildTree();
    const findById = jest
      .fn()
      .mockImplementation((id: { toString: () => string }) =>
        Promise.resolve(id.toString() === corp.id.toString() ? corp : finance),
      );
    const saveMany = jest.fn().mockResolvedValue(undefined);
    const repo = makeRepo({
      findById,
      findDescendants: jest.fn().mockResolvedValue([emea]),
      findByPath: jest.fn().mockResolvedValue(null),
      saveMany,
    });
    const dispatcher = makeDispatcher();
    const useCase = new MoveOrgUnitUseCase(repo, clock, dispatcher);

    const view = await useCase.execute({
      orgUnitId: finance.id.toString(),
      newParentId: corp.id.toString(),
    });

    expect(view.path).toBe('corp.finance');
    expect(view.parentId).toBe(corp.id.toString());
    expect(emea.path.toString()).toBe('corp.finance.emea'); // descendant rebased
    const persisted = saveMany.mock.calls[0][0] as OrgUnit[];
    expect(persisted).toHaveLength(2);

    // The moved node raises OrgUnitMovedEvent; it is dispatched after persistence
    // (DESIGN §3.4). Descendants are only rebased and raise nothing.
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
    const dispatched = (dispatcher.dispatch as jest.Mock).mock
      .calls[0][0] as readonly DomainEvent[];
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toBeInstanceOf(OrgUnitMovedEvent);
    expect(dispatched[0]?.eventName()).toBe('org_unit.moved');
  });

  it('promotes a node to a root when newParentId is null', async () => {
    const { finance } = buildTree();
    const repo = makeRepo({
      findById: jest.fn().mockResolvedValue(finance),
      findDescendants: jest.fn().mockResolvedValue([]),
    });
    const useCase = new MoveOrgUnitUseCase(repo, clock, makeDispatcher());

    const view = await useCase.execute({ orgUnitId: finance.id.toString(), newParentId: null });

    expect(view.path).toBe('finance');
    expect(view.parentId).toBeNull();
  });

  it('rejects a cycle (re-parenting under a descendant)', async () => {
    const { finance, emea } = buildTree();
    const findById = jest
      .fn()
      .mockImplementation((id: { toString: () => string }) =>
        Promise.resolve(id.toString() === emea.id.toString() ? emea : finance),
      );
    const repo = makeRepo({ findById });
    const useCase = new MoveOrgUnitUseCase(repo, clock, makeDispatcher());

    await expect(
      useCase.execute({ orgUnitId: finance.id.toString(), newParentId: emea.id.toString() }),
    ).rejects.toBeInstanceOf(OrgUnitCycleError);
  });

  it('rejects a version mismatch with a ConflictError (-> 409)', async () => {
    const { finance } = buildTree();
    const repo = makeRepo({ findById: jest.fn().mockResolvedValue(finance) });
    const useCase = new MoveOrgUnitUseCase(repo, clock, makeDispatcher());

    await expect(
      useCase.execute({
        orgUnitId: finance.id.toString(),
        newParentId: null,
        expectedVersion: 999,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('throws OrgUnitNotFoundError when the node is absent (-> 404)', async () => {
    const repo = makeRepo({ findById: jest.fn().mockResolvedValue(null) });
    const useCase = new MoveOrgUnitUseCase(repo, clock, makeDispatcher());

    await expect(
      useCase.execute({ orgUnitId: randomUUID(), newParentId: null }),
    ).rejects.toBeInstanceOf(OrgUnitNotFoundError);
  });
});

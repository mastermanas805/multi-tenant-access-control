import { randomUUID } from 'node:crypto';

import {
  ConflictError,
  type Clock,
  type DomainEvent,
  type IDomainEventDispatcher,
} from '@kernel/core';

import { RemovePermissionFromRoleUseCase } from '../application/use-cases/remove-permission-from-role.use-case';
import { Role } from '../domain/role.entity';
import { RolePermissionRemovedEvent } from '../domain/role.events';
import { RoleNotFoundError, RolePermissionError } from '../domain/role.errors';
import { type RoleRepository } from '../domain/role.repository.port';

/** Unit test for the remove-permission-from-role use-case (mocked repository PORT). */
describe('RemovePermissionFromRoleUseCase', () => {
  const fixedNow = new Date('2026-06-06T10:00:00.000Z');
  const clock: Clock = { now: () => fixedNow };
  const tenantId = randomUUID();

  function makeDispatcher(): IDomainEventDispatcher {
    return { dispatch: jest.fn().mockResolvedValue(undefined) };
  }

  function makeRole(): Role {
    return Role.create({
      tenantId,
      key: 'finance_manager',
      scope: 'acme.finance',
      permissions: ['expense:report:read', 'expense:report:approve'],
      now: fixedNow,
    });
  }

  function makeRepo(overrides: Partial<RoleRepository> = {}): RoleRepository {
    return {
      save: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn().mockResolvedValue(null),
      findByKey: jest.fn().mockResolvedValue(null),
      list: jest.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
      ...overrides,
    };
  }

  it('revokes an existing permission, bumps the version, persists, and dispatches the event', async () => {
    const role = makeRole();
    const repo = makeRepo({ findById: jest.fn().mockResolvedValue(role) });
    const dispatcher = makeDispatcher();
    const useCase = new RemovePermissionFromRoleUseCase(repo, clock, dispatcher);

    const view = await useCase.execute({
      roleId: role.id.toString(),
      permission: 'expense:report:approve',
    });

    expect(view.permissions).toEqual(['expense:report:read']);
    expect(view.version).toBe(2);
    expect(repo.save).toHaveBeenCalledTimes(1);

    // The dynamic-management seam (DESIGN §3.4, FR-8): the revoke event is
    // dispatched after persistence so the PIP cache invalidates.
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
    const dispatched = (dispatcher.dispatch as jest.Mock).mock
      .calls[0][0] as readonly DomainEvent[];
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toBeInstanceOf(RolePermissionRemovedEvent);
    expect(dispatched[0]?.eventName()).toBe('role.permission_removed');
  });

  it('raises RoleNotFoundError (-> 404) when the role is absent', async () => {
    const repo = makeRepo();
    const dispatcher = makeDispatcher();
    const useCase = new RemovePermissionFromRoleUseCase(repo, clock, dispatcher);

    await expect(
      useCase.execute({ roleId: randomUUID(), permission: 'expense:report:read' }),
    ).rejects.toBeInstanceOf(RoleNotFoundError);
    expect(repo.save).not.toHaveBeenCalled();
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('rejects removing a permission the role lacks with RolePermissionError (-> 409)', async () => {
    const role = makeRole();
    const repo = makeRepo({ findById: jest.fn().mockResolvedValue(role) });
    const dispatcher = makeDispatcher();
    const useCase = new RemovePermissionFromRoleUseCase(repo, clock, dispatcher);

    await expect(
      useCase.execute({ roleId: role.id.toString(), permission: 'invoice:invoice:void' }),
    ).rejects.toBeInstanceOf(RolePermissionError);
    expect(repo.save).not.toHaveBeenCalled();
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('rejects a stale expectedVersion with a version_mismatch ConflictError (-> 409)', async () => {
    const role = makeRole();
    const repo = makeRepo({ findById: jest.fn().mockResolvedValue(role) });
    const dispatcher = makeDispatcher();
    const useCase = new RemovePermissionFromRoleUseCase(repo, clock, dispatcher);

    await expect(
      useCase.execute({
        roleId: role.id.toString(),
        permission: 'expense:report:read',
        expectedVersion: 99,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(repo.save).not.toHaveBeenCalled();
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });
});

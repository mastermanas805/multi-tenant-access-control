import { type Clock, type DomainEvent, type IDomainEventDispatcher } from '@kernel/core';

import { CreatePermissionUseCase } from '../application/use-cases/create-permission.use-case';
import { type CreatePermissionCommand } from '../application/dto/permission.commands';
import { Permission } from '../domain/permission.entity';
import { PermissionCreatedEvent } from '../domain/permission.events';
import { PermissionKeyTakenError } from '../domain/permission.errors';
import { type PermissionRepository } from '../domain/permission.repository.port';

/**
 * Unit test for the create-permission use-case. The repository PORT and CLOCK
 * port are mocked, so this exercises pure application logic with no NestJS, no
 * DB. Mirrors the Tenant module's use-case unit-test shape.
 */
describe('CreatePermissionUseCase', () => {
  const fixedNow = new Date('2026-06-06T10:00:00.000Z');
  const clock: Clock = { now: () => fixedNow };

  function makeRepo(overrides: Partial<PermissionRepository> = {}): PermissionRepository {
    return {
      save: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn().mockResolvedValue(null),
      findByKey: jest.fn().mockResolvedValue(null),
      list: jest.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
      ...overrides,
    };
  }

  function makeDispatcher(): IDomainEventDispatcher {
    return { dispatch: jest.fn().mockResolvedValue(undefined) };
  }

  const command: CreatePermissionCommand = {
    key: 'expense:report:approve',
    description: 'Approve an expense report',
  };

  it('registers a permission at version 1, persists it, and dispatches the created event', async () => {
    const repo = makeRepo();
    const dispatcher = makeDispatcher();
    const useCase = new CreatePermissionUseCase(repo, clock, dispatcher);

    const view = await useCase.execute(command);

    expect(view.key).toBe('expense:report:approve');
    expect(view.description).toBe('Approve an expense report');
    expect(view.version).toBe(1);
    expect(view.createdAt).toBe(fixedNow.toISOString());
    expect(repo.save).toHaveBeenCalledTimes(1);
    const saved = (repo.save as jest.Mock).mock.calls[0][0] as Permission;
    expect(saved).toBeInstanceOf(Permission);

    // PermissionCreatedEvent is pulled and dispatched AFTER persistence (the
    // dynamic-management seam — DESIGN §3.4), so the aggregate's buffer is empty.
    expect(saved.domainEvents).toHaveLength(0);
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
    const dispatched = (dispatcher.dispatch as jest.Mock).mock
      .calls[0][0] as readonly DomainEvent[];
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toBeInstanceOf(PermissionCreatedEvent);
    expect(dispatched[0]?.eventName()).toBe('permission.created');
  });

  it('rejects a duplicate key with PermissionKeyTakenError (-> 409)', async () => {
    const existing = Permission.create({
      key: 'expense:report:approve',
      description: 'Approve an expense report',
      now: fixedNow,
    });
    const repo = makeRepo({ findByKey: jest.fn().mockResolvedValue(existing) });
    const dispatcher = makeDispatcher();
    const useCase = new CreatePermissionUseCase(repo, clock, dispatcher);

    await expect(useCase.execute(command)).rejects.toBeInstanceOf(PermissionKeyTakenError);
    expect(repo.save).not.toHaveBeenCalled();
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('rejects a malformed key at the domain boundary', async () => {
    const repo = makeRepo();
    const dispatcher = makeDispatcher();
    const useCase = new CreatePermissionUseCase(repo, clock, dispatcher);

    await expect(useCase.execute({ key: 'NotAValidKey', description: 'bad' })).rejects.toThrow();
    expect(repo.save).not.toHaveBeenCalled();
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });
});

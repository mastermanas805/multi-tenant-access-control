import { randomUUID } from 'node:crypto';

import { type Clock } from '@kernel/core';

import { CreateRoleUseCase } from '../application/use-cases/create-role.use-case';
import { type CreateRoleCommand } from '../application/dto/role.commands';
import { Role } from '../domain/role.entity';
import { RoleKeyTakenError } from '../domain/role.errors';
import { type RoleRepository } from '../domain/role.repository.port';

/**
 * Unit test for the create-role use-case. The repository PORT and CLOCK port are
 * mocked, so this exercises pure application logic with no NestJS, no DB.
 */
describe('CreateRoleUseCase', () => {
  const fixedNow = new Date('2026-06-06T10:00:00.000Z');
  const clock: Clock = { now: () => fixedNow };
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

  const command: CreateRoleCommand = {
    tenantId,
    key: 'finance_manager',
    scope: 'acme.finance',
    description: 'Approves finance expense reports',
    permissions: ['expense:report:read', 'expense:report:approve'],
  };

  it('creates a role with its permission grants and persists it', async () => {
    const repo = makeRepo();
    const useCase = new CreateRoleUseCase(repo, clock);

    const view = await useCase.execute(command);

    expect(view.tenantId).toBe(tenantId);
    expect(view.key).toBe('finance_manager');
    expect(view.scope).toBe('acme.finance');
    expect(view.permissions).toEqual(['expense:report:read', 'expense:report:approve']);
    expect(view.version).toBe(1);
    expect(view.createdAt).toBe(fixedNow.toISOString());
    expect(repo.save).toHaveBeenCalledTimes(1);
    const saved = (repo.save as jest.Mock).mock.calls[0][0] as Role;
    expect(saved).toBeInstanceOf(Role);
  });

  it('creates a role with no permissions when none are supplied', async () => {
    const repo = makeRepo();
    const useCase = new CreateRoleUseCase(repo, clock);

    const view = await useCase.execute({ tenantId, key: 'viewer', scope: 'acme' });

    expect(view.permissions).toEqual([]);
  });

  it('rejects a duplicate key with RoleKeyTakenError (-> 409)', async () => {
    const existing = Role.create({
      tenantId,
      key: 'finance_manager',
      scope: 'acme',
      now: fixedNow,
    });
    const repo = makeRepo({ findByKey: jest.fn().mockResolvedValue(existing) });
    const useCase = new CreateRoleUseCase(repo, clock);

    await expect(useCase.execute(command)).rejects.toBeInstanceOf(RoleKeyTakenError);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('rejects an invalid (non-snake) key at the domain boundary', async () => {
    const repo = makeRepo();
    const useCase = new CreateRoleUseCase(repo, clock);

    await expect(
      useCase.execute({ tenantId, key: 'Finance Manager', scope: 'acme' }),
    ).rejects.toThrow();
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('rejects a malformed permission key at the domain boundary', async () => {
    const repo = makeRepo();
    const useCase = new CreateRoleUseCase(repo, clock);

    await expect(
      useCase.execute({ tenantId, key: 'auditor', scope: 'acme', permissions: ['not-valid'] }),
    ).rejects.toThrow();
    expect(repo.save).not.toHaveBeenCalled();
  });
});

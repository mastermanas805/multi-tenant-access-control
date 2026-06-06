import { randomUUID } from 'node:crypto';

import { type Clock } from '@kernel/core';

import { AssignRoleUseCase } from '../application/use-cases/assign-role.use-case';
import { type AssignRoleCommand } from '../application/dto/role-assignment.commands';
import { RoleAssignment } from '../domain/role-assignment.entity';
import { RoleAssignmentAlreadyExistsError } from '../domain/role-assignment.errors';
import { type RoleAssignmentRepository } from '../domain/role-assignment.repository.port';
import { ScopePath } from '../domain/value-objects/scope-path.vo';

/**
 * Unit test for the assign-role use-case. The repository PORT and CLOCK port are
 * mocked, so this exercises pure application logic with no NestJS, no DB.
 */
describe('AssignRoleUseCase', () => {
  const fixedNow = new Date('2026-06-06T10:00:00.000Z');
  const clock: Clock = { now: () => fixedNow };
  const tenantId = randomUUID();

  function makeRepo(overrides: Partial<RoleAssignmentRepository> = {}): RoleAssignmentRepository {
    return {
      save: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn().mockResolvedValue(null),
      findActiveAssignment: jest.fn().mockResolvedValue(null),
      listForUser: jest.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
      ...overrides,
    };
  }

  const command: AssignRoleCommand = {
    tenantId,
    userId: 'user_riya',
    roleId: 'role_7f3',
    scope: 'acme.finance.emea',
  };

  it('assigns an active role and persists it', async () => {
    const repo = makeRepo();
    const useCase = new AssignRoleUseCase(repo, clock);

    const view = await useCase.execute(command);

    expect(view.userId).toBe('user_riya');
    expect(view.roleId).toBe('role_7f3');
    expect(view.scope).toBe('acme.finance.emea');
    expect(view.tenantId).toBe(tenantId);
    expect(view.status).toBe('active');
    expect(view.validUntil).toBeNull();
    expect(view.delegatedBy).toBeNull();
    expect(view.version).toBe(1);
    expect(view.createdAt).toBe(fixedNow.toISOString());
    expect(repo.save).toHaveBeenCalledTimes(1);
    const saved = (repo.save as jest.Mock).mock.calls[0][0] as RoleAssignment;
    expect(saved).toBeInstanceOf(RoleAssignment);
  });

  it('records delegation metadata (validUntil + delegatedBy)', async () => {
    const repo = makeRepo();
    const useCase = new AssignRoleUseCase(repo, clock);

    const view = await useCase.execute({
      ...command,
      validUntil: '2026-12-31T23:59:59.000Z',
      delegatedBy: 'user_admin',
    });

    expect(view.validUntil).toBe(new Date('2026-12-31T23:59:59.000Z').toISOString());
    expect(view.delegatedBy).toBe('user_admin');
  });

  it('rejects a duplicate active assignment with RoleAssignmentAlreadyExistsError (-> 409)', async () => {
    const existing = RoleAssignment.create({
      tenantId,
      userId: 'user_riya',
      roleId: 'role_7f3',
      scope: ScopePath.fromString('acme.finance.emea'),
      now: fixedNow,
    });
    const repo = makeRepo({ findActiveAssignment: jest.fn().mockResolvedValue(existing) });
    const useCase = new AssignRoleUseCase(repo, clock);

    await expect(useCase.execute(command)).rejects.toBeInstanceOf(RoleAssignmentAlreadyExistsError);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('rejects an invalid scope path at the domain boundary', async () => {
    const repo = makeRepo();
    const useCase = new AssignRoleUseCase(repo, clock);

    await expect(useCase.execute({ ...command, scope: 'Acme Finance EMEA' })).rejects.toThrow();
    expect(repo.save).not.toHaveBeenCalled();
  });
});

import { randomUUID } from 'node:crypto';

import {
  ConflictError,
  type Clock,
  type DomainEvent,
  type IDomainEventDispatcher,
} from '@kernel/core';

import { RevokeRoleUseCase } from '../application/use-cases/revoke-role.use-case';
import { type RevokeRoleCommand } from '../application/dto/role-assignment.commands';
import { RoleAssignment } from '../domain/role-assignment.entity';
import { RoleAssignmentRevokedEvent } from '../domain/role-assignment.events';
import { RoleAssignmentNotFoundError } from '../domain/role-assignment.errors';
import { type RoleAssignmentRepository } from '../domain/role-assignment.repository.port';
import { ScopePath } from '../domain/value-objects/scope-path.vo';

/**
 * Unit test for the revoke-role use-case. Asserts the dynamic-management seam
 * (DESIGN §3.4): a RoleAssignmentRevokedEvent is dispatched via the kernel
 * IDomainEventDispatcher AFTER persistence, and optimistic concurrency is honored.
 */
describe('RevokeRoleUseCase', () => {
  const fixedNow = new Date('2026-06-06T10:00:00.000Z');
  const clock: Clock = { now: () => fixedNow };
  const tenantId = randomUUID();

  function makeAssignment(): RoleAssignment {
    return RoleAssignment.create({
      tenantId,
      userId: 'user_riya',
      roleId: 'role_7f3',
      scope: ScopePath.fromString('acme.finance.emea'),
      now: fixedNow,
    });
  }

  function makeRepo(overrides: Partial<RoleAssignmentRepository> = {}): RoleAssignmentRepository {
    return {
      save: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn().mockResolvedValue(null),
      findActiveAssignment: jest.fn().mockResolvedValue(null),
      listForUser: jest.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
      ...overrides,
    };
  }

  function makeDispatcher(): IDomainEventDispatcher {
    return { dispatch: jest.fn().mockResolvedValue(undefined) };
  }

  it('revokes the assignment, persists it, and dispatches RoleAssignmentRevokedEvent', async () => {
    const assignment = makeAssignment();
    const id = assignment.id.toString();
    const repo = makeRepo({ findById: jest.fn().mockResolvedValue(assignment) });
    const dispatcher = makeDispatcher();
    const useCase = new RevokeRoleUseCase(repo, clock, dispatcher);

    const view = await useCase.execute({ roleAssignmentId: id });

    expect(view.status).toBe('revoked');
    expect(view.version).toBe(2);
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);

    const dispatched = (dispatcher.dispatch as jest.Mock).mock
      .calls[0][0] as readonly DomainEvent[];
    expect(dispatched).toHaveLength(1);
    const event = dispatched[0];
    expect(event).toBeInstanceOf(RoleAssignmentRevokedEvent);
    const revoked = event as RoleAssignmentRevokedEvent;
    expect(revoked.eventName()).toBe('role_assignment.revoked');
    expect(revoked.userId).toBe('user_riya');
    expect(revoked.tenantId).toBe(tenantId);
  });

  it('raises RoleAssignmentNotFoundError when absent and dispatches nothing', async () => {
    const repo = makeRepo({ findById: jest.fn().mockResolvedValue(null) });
    const dispatcher = makeDispatcher();
    const useCase = new RevokeRoleUseCase(repo, clock, dispatcher);

    const command: RevokeRoleCommand = { roleAssignmentId: randomUUID() };

    await expect(useCase.execute(command)).rejects.toBeInstanceOf(RoleAssignmentNotFoundError);
    expect(repo.save).not.toHaveBeenCalled();
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('rejects a stale If-Match version with a ConflictError (-> 409)', async () => {
    const assignment = makeAssignment(); // version 1
    const repo = makeRepo({ findById: jest.fn().mockResolvedValue(assignment) });
    const dispatcher = makeDispatcher();
    const useCase = new RevokeRoleUseCase(repo, clock, dispatcher);

    await expect(
      useCase.execute({ roleAssignmentId: assignment.id.toString(), expectedVersion: 99 }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(repo.save).not.toHaveBeenCalled();
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });
});

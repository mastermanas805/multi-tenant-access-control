import { randomUUID } from 'node:crypto';

import { makeCursorPage } from '@kernel/core';

import { ListAssignmentsForUserUseCase } from '../application/use-cases/list-assignments-for-user.use-case';
import { RoleAssignment } from '../domain/role-assignment.entity';
import { type RoleAssignmentRepository } from '../domain/role-assignment.repository.port';
import { ScopePath } from '../domain/value-objects/scope-path.vo';

/** Unit test for the list-assignments-for-user use-case (mocked port). */
describe('ListAssignmentsForUserUseCase', () => {
  const fixedNow = new Date('2026-06-06T10:00:00.000Z');
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

  it("returns the user's assignments as a page view and forwards the clamped query", async () => {
    const assignment = RoleAssignment.create({
      tenantId,
      userId: 'user_riya',
      roleId: 'role_7f3',
      scope: ScopePath.fromString('acme.finance.emea'),
      now: fixedNow,
    });
    const listForUser = jest.fn().mockResolvedValue(makeCursorPage([assignment], null));
    const repo = makeRepo({ listForUser });
    const useCase = new ListAssignmentsForUserUseCase(repo);

    const view = await useCase.execute({ userId: 'user_riya', limit: 10 });

    expect(view.items).toHaveLength(1);
    expect(view.items[0]?.userId).toBe('user_riya');
    expect(view.nextCursor).toBeNull();
    expect(view.hasMore).toBe(false);

    expect(listForUser).toHaveBeenCalledTimes(1);
    const [userIdArg, pageArg] = listForUser.mock.calls[0] as [string, { limit: number }];
    expect(userIdArg).toBe('user_riya');
    expect(pageArg.limit).toBe(10);
  });

  it('clamps an over-large limit to the kernel maximum (100)', async () => {
    const listForUser = jest
      .fn()
      .mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
    const repo = makeRepo({ listForUser });
    const useCase = new ListAssignmentsForUserUseCase(repo);

    await useCase.execute({ userId: 'user_riya', limit: 9999 });

    const [, pageArg] = listForUser.mock.calls[0] as [string, { limit: number }];
    expect(pageArg.limit).toBe(100);
  });
});

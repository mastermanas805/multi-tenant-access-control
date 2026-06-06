import { randomUUID } from 'node:crypto';

import { GetPermissionUseCase } from '../application/use-cases/get-permission.use-case';
import { Permission } from '../domain/permission.entity';
import { PermissionNotFoundError } from '../domain/permission.errors';
import { type PermissionRepository } from '../domain/permission.repository.port';

/** Unit test for the get-permission use-case (repository PORT mocked). */
describe('GetPermissionUseCase', () => {
  const fixedNow = new Date('2026-06-06T10:00:00.000Z');

  function makeRepo(overrides: Partial<PermissionRepository> = {}): PermissionRepository {
    return {
      save: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn().mockResolvedValue(null),
      findByKey: jest.fn().mockResolvedValue(null),
      list: jest.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
      ...overrides,
    };
  }

  it('returns the view for an existing permission', async () => {
    const permission = Permission.create({
      key: 'expense:report:approve',
      description: 'Approve an expense report',
      now: fixedNow,
    });
    const repo = makeRepo({ findById: jest.fn().mockResolvedValue(permission) });
    const useCase = new GetPermissionUseCase(repo);

    const view = await useCase.execute({ permissionId: permission.id.toString() });

    expect(view.id).toBe(permission.id.toString());
    expect(view.key).toBe('expense:report:approve');
  });

  it('raises PermissionNotFoundError when absent (-> 404)', async () => {
    const repo = makeRepo();
    const useCase = new GetPermissionUseCase(repo);

    await expect(useCase.execute({ permissionId: randomUUID() })).rejects.toBeInstanceOf(
      PermissionNotFoundError,
    );
  });

  it('rejects a malformed id at the value-object boundary', async () => {
    const repo = makeRepo();
    const useCase = new GetPermissionUseCase(repo);

    await expect(useCase.execute({ permissionId: 'not-a-uuid' })).rejects.toThrow();
    expect(repo.findById).not.toHaveBeenCalled();
  });
});

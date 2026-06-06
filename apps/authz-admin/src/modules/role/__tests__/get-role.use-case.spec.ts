import { randomUUID } from 'node:crypto';

import { GetRoleUseCase } from '../application/use-cases/get-role.use-case';
import { Role } from '../domain/role.entity';
import { RoleNotFoundError } from '../domain/role.errors';
import { type RoleRepository } from '../domain/role.repository.port';

/** Unit test for the get-role use-case (mocked repository PORT). */
describe('GetRoleUseCase', () => {
  const fixedNow = new Date('2026-06-06T10:00:00.000Z');
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

  it('returns the view for an existing role', async () => {
    const role = Role.create({ tenantId, key: 'viewer', scope: 'acme', now: fixedNow });
    const repo = makeRepo({ findById: jest.fn().mockResolvedValue(role) });
    const useCase = new GetRoleUseCase(repo);

    const view = await useCase.execute({ roleId: role.id.toString() });

    expect(view.key).toBe('viewer');
    expect(view.scope).toBe('acme');
  });

  it('raises RoleNotFoundError (-> 404) when absent', async () => {
    const repo = makeRepo();
    const useCase = new GetRoleUseCase(repo);

    await expect(useCase.execute({ roleId: randomUUID() })).rejects.toBeInstanceOf(
      RoleNotFoundError,
    );
  });

  it('rejects a malformed role id at the domain boundary', async () => {
    const repo = makeRepo();
    const useCase = new GetRoleUseCase(repo);

    await expect(useCase.execute({ roleId: 'not-a-uuid' })).rejects.toThrow();
    expect(repo.findById).not.toHaveBeenCalled();
  });
});

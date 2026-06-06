import { type Clock } from '@kernel/core';

import { CreateTenantUseCase } from '../application/use-cases/create-tenant.use-case';
import { type CreateTenantCommand } from '../application/dto/tenant.commands';
import { Tenant } from '../domain/tenant.entity';
import { TenantSlugTakenError } from '../domain/tenant.errors';
import { type TenantRepository } from '../domain/tenant.repository.port';

/**
 * Unit test for the create-tenant use-case. The repository PORT and CLOCK port
 * are mocked, so this exercises pure application logic with no NestJS, no DB.
 * Every feature module's use-case unit test follows this shape.
 */
describe('CreateTenantUseCase', () => {
  const fixedNow = new Date('2026-06-06T10:00:00.000Z');
  const clock: Clock = { now: () => fixedNow };

  function makeRepo(overrides: Partial<TenantRepository> = {}): TenantRepository {
    return {
      save: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn().mockResolvedValue(null),
      findBySlug: jest.fn().mockResolvedValue(null),
      list: jest.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
      ...overrides,
    };
  }

  const command: CreateTenantCommand = { name: 'Acme Corporation', slug: 'acme' };

  it('creates an active, pool-tier tenant and persists it', async () => {
    const repo = makeRepo();
    const useCase = new CreateTenantUseCase(repo, clock);

    const view = await useCase.execute(command);

    expect(view.name).toBe('Acme Corporation');
    expect(view.slug).toBe('acme');
    expect(view.status).toBe('active');
    expect(view.isolationTier).toBe('pool');
    expect(view.version).toBe(1);
    expect(view.createdAt).toBe(fixedNow.toISOString());
    expect(repo.save).toHaveBeenCalledTimes(1);
    const saved = (repo.save as jest.Mock).mock.calls[0][0] as Tenant;
    expect(saved).toBeInstanceOf(Tenant);
  });

  it('honors an explicit isolation tier', async () => {
    const repo = makeRepo();
    const useCase = new CreateTenantUseCase(repo, clock);

    const view = await useCase.execute({ ...command, isolationTier: 'silo' });

    expect(view.isolationTier).toBe('silo');
  });

  it('rejects a duplicate slug with TenantSlugTakenError (-> 409)', async () => {
    const existing = Tenant.create({ name: 'Acme', slug: 'acme', now: fixedNow });
    const repo = makeRepo({ findBySlug: jest.fn().mockResolvedValue(existing) });
    const useCase = new CreateTenantUseCase(repo, clock);

    await expect(useCase.execute(command)).rejects.toBeInstanceOf(TenantSlugTakenError);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('rejects an invalid (non-kebab) slug at the domain boundary', async () => {
    const repo = makeRepo();
    const useCase = new CreateTenantUseCase(repo, clock);

    await expect(useCase.execute({ name: 'Bad', slug: 'Not Valid Slug' })).rejects.toThrow();
    expect(repo.save).not.toHaveBeenCalled();
  });
});

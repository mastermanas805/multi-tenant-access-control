import { type Clock, type DomainEvent, type IDomainEventDispatcher } from '@kernel/core';

import { ActivatePolicyUseCase } from '../application/use-cases/activate-policy.use-case';
import { GetPolicyUseCase } from '../application/use-cases/get-policy.use-case';
import { ListPoliciesUseCase } from '../application/use-cases/list-policies.use-case';
import { PublishPolicyUseCase } from '../application/use-cases/publish-policy.use-case';
import { RollbackPolicyUseCase } from '../application/use-cases/rollback-policy.use-case';
import { type PublishPolicyCommand } from '../application/dto/policy.commands';
import { Policy, PolicyStatus } from '../domain/policy.entity';
import { PolicyPublishedEvent } from '../domain/policy.events';
import {
  PolicyNotFoundError,
  PolicyStatusError,
  PolicyVersionNotFoundError,
} from '../domain/policy.errors';
import { type PolicyRepository } from '../domain/policy.repository.port';
import { PolicyScope } from '../domain/value-objects/policy-scope.vo';

/**
 * Unit tests for the Policy use-cases. The repository PORT and CLOCK port are
 * mocked, so these exercise pure application logic with no NestJS, no DB. Mirrors
 * the shape of the Tenant reference suite (one assertion block per use-case).
 */
describe('Policy use-cases', () => {
  const fixedNow = new Date('2026-06-06T10:00:00.000Z');
  const clock: Clock = { now: () => fixedNow };
  const tenantId = '99999999-9999-4999-8999-999999999999';

  function makeRepo(overrides: Partial<PolicyRepository> = {}): PolicyRepository {
    return {
      // The real repository stamps the owning tenant from the ambient context on
      // save; the mock mirrors that contract so the published view carries it.
      save: jest.fn().mockImplementation((policy: Policy) => {
        policy.stampTenant(tenantId);
        return Promise.resolve();
      }),
      findById: jest.fn().mockResolvedValue(null),
      findLatestForScope: jest.fn().mockResolvedValue(null),
      findByScopeAndVersion: jest.fn().mockResolvedValue(null),
      list: jest.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
      ...overrides,
    };
  }

  function makeDispatcher(): IDomainEventDispatcher {
    return { dispatch: jest.fn().mockResolvedValue(undefined) };
  }

  function makePolicy(version: number, status: PolicyStatus = PolicyStatus.Staged): Policy {
    const policy = Policy.publish({
      scope: PolicyScope.fromString('acme.finance'),
      rule: { effect: 'ALLOW' },
      version,
      effectiveDate: fixedNow,
      now: fixedNow,
    });
    policy.pullDomainEvents();
    // Represents a persisted/rehydrated policy, so it already carries its tenant.
    policy.stampTenant(tenantId);
    if (status === PolicyStatus.Active) {
      policy.activate(fixedNow);
    }
    return policy;
  }

  const publishCommand: PublishPolicyCommand = {
    scope: 'acme.finance',
    rule: { effect: 'ALLOW', condition: 'amount < 10000' },
    effectiveDate: '2026-07-01T00:00:00.000Z',
  };

  describe('PublishPolicyUseCase', () => {
    it('publishes a staged v1 for a brand-new scope, persists it, and dispatches the event', async () => {
      const repo = makeRepo();
      const dispatcher = makeDispatcher();
      const useCase = new PublishPolicyUseCase(repo, clock, dispatcher);

      const view = await useCase.execute(publishCommand);

      expect(view.scope).toBe('acme.finance');
      expect(view.status).toBe('staged');
      expect(view.version).toBe(1);
      expect(view.effectiveDate).toBe('2026-07-01T00:00:00.000Z');
      expect(view.createdAt).toBe(fixedNow.toISOString());
      expect(repo.save).toHaveBeenCalledTimes(1);
      const saved = (repo.save as jest.Mock).mock.calls[0][0] as Policy;
      expect(saved).toBeInstanceOf(Policy);

      // PolicyPublishedEvent is pulled and dispatched AFTER persistence
      // (DESIGN §3.4 sequence), so the aggregate's own buffer is empty.
      expect(saved.pullDomainEvents()).toHaveLength(0);
      expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
      const dispatched = (dispatcher.dispatch as jest.Mock).mock
        .calls[0][0] as readonly DomainEvent[];
      expect(dispatched).toHaveLength(1);
      expect(dispatched[0]).toBeInstanceOf(PolicyPublishedEvent);
      expect(dispatched[0]?.eventName()).toBe('policy.published');
    });

    it('computes the next monotonic version from the latest for the scope', async () => {
      const repo = makeRepo({ findLatestForScope: jest.fn().mockResolvedValue(makePolicy(6)) });
      const useCase = new PublishPolicyUseCase(repo, clock, makeDispatcher());

      const view = await useCase.execute(publishCommand);

      expect(view.version).toBe(7);
    });

    it('rejects a malformed scope at the domain boundary', async () => {
      const repo = makeRepo();
      const dispatcher = makeDispatcher();
      const useCase = new PublishPolicyUseCase(repo, clock, dispatcher);

      await expect(useCase.execute({ ...publishCommand, scope: 'Acme Finance' })).rejects.toThrow();
      expect(repo.save).not.toHaveBeenCalled();
      expect(dispatcher.dispatch).not.toHaveBeenCalled();
    });
  });

  describe('ActivatePolicyUseCase', () => {
    it('activates a staged version and persists it', async () => {
      const staged = makePolicy(3);
      const repo = makeRepo({ findById: jest.fn().mockResolvedValue(staged) });
      const useCase = new ActivatePolicyUseCase(repo, clock);

      const view = await useCase.execute({ policyId: staged.id.toString() });

      expect(view.status).toBe('active');
      expect(view.version).toBe(3); // status change does NOT bump the monotonic version
      expect(repo.save).toHaveBeenCalledTimes(1);
    });

    it('raises PolicyNotFoundError for an unknown id', async () => {
      const repo = makeRepo();
      const useCase = new ActivatePolicyUseCase(repo, clock);

      await expect(
        useCase.execute({ policyId: '11111111-1111-4111-8111-111111111111' }),
      ).rejects.toBeInstanceOf(PolicyNotFoundError);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('rejects activating an already-active version with PolicyStatusError', async () => {
      const active = makePolicy(3, PolicyStatus.Active);
      const repo = makeRepo({ findById: jest.fn().mockResolvedValue(active) });
      const useCase = new ActivatePolicyUseCase(repo, clock);

      await expect(useCase.execute({ policyId: active.id.toString() })).rejects.toBeInstanceOf(
        PolicyStatusError,
      );
    });

    it('rejects a stale If-Match version with a version_mismatch conflict', async () => {
      const staged = makePolicy(3);
      const repo = makeRepo({ findById: jest.fn().mockResolvedValue(staged) });
      const useCase = new ActivatePolicyUseCase(repo, clock);

      await expect(
        useCase.execute({ policyId: staged.id.toString(), expectedVersion: 2 }),
      ).rejects.toMatchObject({ reason: 'version_mismatch' });
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('RollbackPolicyUseCase', () => {
    it('republishes a prior version rule as the next monotonic version (staged)', async () => {
      const current = makePolicy(7);
      const target = Policy.publish({
        scope: PolicyScope.fromString('acme.finance'),
        rule: { effect: 'DENY', note: 'v6 rule' },
        version: 6,
        effectiveDate: fixedNow,
        now: fixedNow,
      });
      target.pullDomainEvents();
      const repo = makeRepo({
        findById: jest.fn().mockResolvedValue(current),
        findByScopeAndVersion: jest.fn().mockResolvedValue(target),
        findLatestForScope: jest.fn().mockResolvedValue(current),
      });
      const dispatcher = makeDispatcher();
      const useCase = new RollbackPolicyUseCase(repo, clock, dispatcher);

      const view = await useCase.execute({ policyId: current.id.toString(), toVersion: 6 });

      expect(view.version).toBe(8); // forward-only: latest (7) + 1
      expect(view.status).toBe('staged');
      expect(view.rule).toEqual({ effect: 'DENY', note: 'v6 rule' });
      expect(repo.save).toHaveBeenCalledTimes(1);

      // The republished version raises PolicyPublishedEvent, dispatched after save.
      expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
      const dispatched = (dispatcher.dispatch as jest.Mock).mock
        .calls[0][0] as readonly DomainEvent[];
      expect(dispatched).toHaveLength(1);
      expect(dispatched[0]).toBeInstanceOf(PolicyPublishedEvent);
    });

    it('raises PolicyNotFoundError when the source policy is missing', async () => {
      const repo = makeRepo();
      const useCase = new RollbackPolicyUseCase(repo, clock, makeDispatcher());

      await expect(
        useCase.execute({ policyId: '22222222-2222-4222-8222-222222222222', toVersion: 1 }),
      ).rejects.toBeInstanceOf(PolicyNotFoundError);
    });

    it('raises PolicyVersionNotFoundError when the target version is absent', async () => {
      const current = makePolicy(7);
      const repo = makeRepo({
        findById: jest.fn().mockResolvedValue(current),
        findByScopeAndVersion: jest.fn().mockResolvedValue(null),
      });
      const useCase = new RollbackPolicyUseCase(repo, clock, makeDispatcher());

      await expect(
        useCase.execute({ policyId: current.id.toString(), toVersion: 99 }),
      ).rejects.toBeInstanceOf(PolicyVersionNotFoundError);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('GetPolicyUseCase', () => {
    it('returns the view for an existing policy', async () => {
      const policy = makePolicy(2);
      const repo = makeRepo({ findById: jest.fn().mockResolvedValue(policy) });
      const useCase = new GetPolicyUseCase(repo);

      const view = await useCase.execute({ policyId: policy.id.toString() });

      expect(view.id).toBe(policy.id.toString());
      expect(view.version).toBe(2);
    });

    it('raises PolicyNotFoundError for an unknown id', async () => {
      const repo = makeRepo();
      const useCase = new GetPolicyUseCase(repo);

      await expect(
        useCase.execute({ policyId: '33333333-3333-4333-8333-333333333333' }),
      ).rejects.toBeInstanceOf(PolicyNotFoundError);
    });
  });

  describe('ListPoliciesUseCase', () => {
    it('returns a page view from the repository', async () => {
      const policy = makePolicy(1);
      const repo = makeRepo({
        list: jest.fn().mockResolvedValue({ items: [policy], nextCursor: null, hasMore: false }),
      });
      const useCase = new ListPoliciesUseCase(repo);

      const view = await useCase.execute({ limit: 10 });

      expect(view.items).toHaveLength(1);
      expect(view.items[0]?.id).toBe(policy.id.toString());
      expect(view.hasMore).toBe(false);
    });
  });
});

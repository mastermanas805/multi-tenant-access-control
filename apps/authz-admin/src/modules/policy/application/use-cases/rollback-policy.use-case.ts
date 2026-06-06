import { Inject, Injectable } from '@nestjs/common';

import {
  type Clock,
  CLOCK,
  type IDomainEventDispatcher,
  DOMAIN_EVENT_DISPATCHER,
} from '@kernel/core';

import { Policy } from '../../domain/policy.entity';
import { PolicyNotFoundError, PolicyVersionNotFoundError } from '../../domain/policy.errors';
import { type PolicyRepository, POLICY_REPOSITORY } from '../../domain/policy.repository.port';
import { PolicyId } from '../../domain/value-objects/policy-id.vo';
import { type RollbackPolicyCommand } from '../dto/policy.commands';
import { type PolicyView, toPolicyView } from '../dto/policy.view';

/**
 * Rolls a policy scope back to a previously-published version (DESIGN §8.2:
 * `POST /policies/:id/rollback {toVersion}` -> a NEW staged version carrying the
 * target version's rule). Rollback is forward-only: history is immutable, so the
 * republished rule gets the next monotonic version, not the old one.
 */
@Injectable()
export class RollbackPolicyUseCase {
  constructor(
    @Inject(POLICY_REPOSITORY) private readonly policies: PolicyRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(DOMAIN_EVENT_DISPATCHER) private readonly dispatcher: IDomainEventDispatcher,
  ) {}

  public async execute(command: RollbackPolicyCommand): Promise<PolicyView> {
    const id = PolicyId.fromString(command.policyId);
    const current = await this.policies.findById(id);
    if (!current) {
      throw new PolicyNotFoundError(command.policyId);
    }

    const scope = current.scope;

    const target = await this.policies.findByScopeAndVersion(scope, command.toVersion);
    if (!target) {
      throw new PolicyVersionNotFoundError(scope.toString(), command.toVersion);
    }

    const latest = await this.policies.findLatestForScope(scope);
    const nextVersion = latest ? latest.version + 1 : 1;

    const republished = Policy.publish({
      scope,
      rule: target.rule,
      version: nextVersion,
      effectiveDate: this.clock.now(),
      now: this.clock.now(),
    });

    await this.policies.save(republished);

    // The republished version raises a PolicyPublishedEvent (via Policy.publish);
    // dispatch it after persistence (DESIGN §3.4 sequence).
    await this.dispatcher.dispatch(republished.pullDomainEvents());

    return toPolicyView(republished);
  }
}

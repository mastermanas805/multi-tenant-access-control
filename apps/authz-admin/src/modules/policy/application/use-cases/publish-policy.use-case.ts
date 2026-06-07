import { Inject, Injectable } from '@nestjs/common';

import {
  type Clock,
  CLOCK,
  type IDomainEventDispatcher,
  DOMAIN_EVENT_DISPATCHER,
} from '@kernel/core';

import { Policy } from '../../domain/policy.entity';
import { type PolicyRepository, POLICY_REPOSITORY } from '../../domain/policy.repository.port';
import { PolicyScope } from '../../domain/value-objects/policy-scope.vo';
import { type PolicyPublisher, POLICY_PUBLISHER } from '../ports/policy-publisher.port';
import { type PublishPolicyCommand } from '../dto/policy.commands';
import { type PolicyView, toPolicyView } from '../dto/policy.view';

/**
 * Publishes a new policy version for a scope (DESIGN §8.2). Computes the next
 * monotonic version (max existing for the scope + 1), builds the aggregate as
 * STAGED, persists it, and returns the view. The aggregate records a
 * PolicyPublishedEvent which the dispatcher publishes after save.
 *
 * Tenant-agnostic: RLS + the ambient context scope all reads, and the repository
 * stamps the owning tenant_id on insert.
 */
@Injectable()
export class PublishPolicyUseCase {
  constructor(
    @Inject(POLICY_REPOSITORY) private readonly policies: PolicyRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(DOMAIN_EVENT_DISPATCHER) private readonly dispatcher: IDomainEventDispatcher,
    @Inject(POLICY_PUBLISHER) private readonly publisher: PolicyPublisher,
  ) {}

  public async execute(command: PublishPolicyCommand): Promise<PolicyView> {
    const scope = PolicyScope.fromString(command.scope);

    const latest = await this.policies.findLatestForScope(scope);
    const nextVersion = latest ? latest.version + 1 : 1;

    const policy = Policy.publish({
      scope,
      rule: command.rule,
      version: nextVersion,
      effectiveDate: new Date(command.effectiveDate),
      now: this.clock.now(),
    });

    await this.policies.save(policy);

    // Compile + publish the version to the PDP so it becomes effective within
    // seconds (DESIGN §3.4). Done AFTER persistence so the source of truth is
    // committed first; a compile/write error is fail-closed (it throws), keeping
    // the DB and PDP from silently diverging. Nothing here is hardcoded — the
    // rule is the runtime, user-authored jsonb.
    await this.publisher.publish(policy);

    // Publish after persistence so the source of truth is committed before any
    // downstream republish/cache-invalidation reacts (DESIGN §3.4 sequence).
    await this.dispatcher.dispatch(policy.pullDomainEvents());

    return toPolicyView(policy);
  }
}

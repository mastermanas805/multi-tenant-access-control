import { DomainEvent, type UniqueEntityID } from '@kernel/core';

/**
 * Raised when a new policy version is published (DESIGN §3.4, §8.7). A subscriber
 * (out of scope here) would trigger the PAP to recompile + republish the signed
 * Cerbos bundle and emit a change event so PDPs hot-reload and PIP caches
 * invalidate within seconds.
 */
export class PolicyPublishedEvent extends DomainEvent {
  public readonly scope: string;
  public readonly version: number;

  constructor(aggregateId: UniqueEntityID, scope: string, version: number) {
    super(aggregateId);
    this.scope = scope;
    this.version = version;
  }

  public eventName(): string {
    return 'policy.published';
  }
}

import { DomainEvent, type UniqueEntityID } from '@kernel/core';

/**
 * Raised when a new capability is registered in the global permission catalog.
 * A subscriber (out of scope here) might refresh PDP/PIP capability metadata or
 * audit the catalog change.
 */
export class PermissionCreatedEvent extends DomainEvent {
  public readonly key: string;

  constructor(aggregateId: UniqueEntityID, key: string) {
    super(aggregateId);
    this.key = key;
  }

  public eventName(): string {
    return 'permission.created';
  }
}

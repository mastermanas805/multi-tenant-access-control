import { type UniqueEntityID } from './unique-entity-id';

/**
 * Base class for domain events. Every event carries the aggregate id it
 * originated from and the instant it occurred. Concrete events add a stable
 * `eventName` (e.g. "tenant.suspended") and a typed payload.
 */
export abstract class DomainEvent {
  public readonly occurredAt: Date;
  public readonly aggregateId: UniqueEntityID;

  protected constructor(aggregateId: UniqueEntityID, occurredAt?: Date) {
    this.aggregateId = aggregateId;
    this.occurredAt = occurredAt ?? new Date();
  }

  /** Stable, dot-delimited name used for routing on the event bus. */
  public abstract eventName(): string;
}

/**
 * Port for publishing domain events out of the application boundary
 * (e.g. onto the event bus that invalidates PIP caches — DESIGN §3.4).
 * The infrastructure layer provides the concrete adapter.
 */
export interface IDomainEventDispatcher {
  dispatch(events: readonly DomainEvent[]): Promise<void>;
}

/** DI token for the dispatcher port. */
export const DOMAIN_EVENT_DISPATCHER = Symbol('DOMAIN_EVENT_DISPATCHER');

import { type DomainEvent } from './domain-event';
import { Entity } from './entity';
import { type UniqueEntityID } from './unique-entity-id';

/**
 * Base class for aggregate roots. Records domain events raised during a unit of
 * work; the application layer pulls them after persistence and hands them to the
 * IDomainEventDispatcher.
 */
export abstract class AggregateRoot<TProps> extends Entity<TProps> {
  private _domainEvents: DomainEvent[] = [];

  protected constructor(props: TProps, id?: UniqueEntityID) {
    super(props, id);
  }

  public get domainEvents(): readonly DomainEvent[] {
    return this._domainEvents;
  }

  protected addDomainEvent(event: DomainEvent): void {
    this._domainEvents.push(event);
  }

  /** Returns and clears the recorded events. Call after the aggregate is saved. */
  public pullDomainEvents(): readonly DomainEvent[] {
    const events = this._domainEvents;
    this._domainEvents = [];
    return events;
  }
}

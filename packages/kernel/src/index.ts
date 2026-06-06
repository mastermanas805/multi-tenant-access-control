// Domain building blocks
export { Entity } from './domain/entity';
export { AggregateRoot } from './domain/aggregate-root';
export { ValueObject } from './domain/value-object';
export { UniqueEntityID } from './domain/unique-entity-id';

// Domain events
export {
  DomainEvent,
  type IDomainEventDispatcher,
  DOMAIN_EVENT_DISPATCHER,
} from './domain/domain-event';

// Errors + guards
export {
  DomainError,
  NotFoundError,
  ConflictError,
  ValidationError,
  ForbiddenError,
} from './errors/domain-error';
export { Guard, invariant } from './errors/guard';

// Pagination
export {
  type CursorPage,
  PageQuery,
  Cursor,
  makeCursorPage,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
} from './pagination/pagination';

// Time
export { type Clock, SystemClock, CLOCK } from './time/clock';

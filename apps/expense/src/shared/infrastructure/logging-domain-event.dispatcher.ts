import { Injectable, Logger } from '@nestjs/common';

import { type DomainEvent, type IDomainEventDispatcher } from '@kernel/core';

/**
 * Default, GLOBAL adapter for the kernel IDomainEventDispatcher port. The kernel
 * ships the DOMAIN_EVENT_DISPATCHER token with NO concrete adapter wired yet, so
 * until the event bus exists this adapter logs each event the Expense aggregate
 * raises (e.g. `expense.approved`).
 *
 * Bound ONCE in the global SharedModule so the approve use-case can inject
 * DOMAIN_EVENT_DISPATCHER and dispatch the events its aggregate raised. To go to
 * production, replace ONLY this binding with the real bus adapter — the
 * application layer depends on the port, not this class.
 */
@Injectable()
export class LoggingDomainEventDispatcher implements IDomainEventDispatcher {
  private readonly logger = new Logger(LoggingDomainEventDispatcher.name);

  public dispatch(events: readonly DomainEvent[]): Promise<void> {
    for (const event of events) {
      this.logger.log(
        `domain event ${event.eventName()} for aggregate ${event.aggregateId.toString()} (placeholder dispatcher — bind a real event bus)`,
      );
    }
    return Promise.resolve();
  }
}

import { Injectable, Logger } from '@nestjs/common';

import { type DomainEvent, type IDomainEventDispatcher } from '@kernel/core';

/**
 * Default, GLOBAL adapter for the kernel IDomainEventDispatcher port. The kernel
 * ships the DOMAIN_EVENT_DISPATCHER token with NO concrete adapter wired yet (see
 * ARCHITECTURE.md / kernel barrel) — until the event bus exists, this adapter
 * logs each event so the dynamic-management seam (DESIGN §3.4) is observable.
 *
 * Bound ONCE in the global SharedModule so EVERY mutation use-case across every
 * module can inject DOMAIN_EVENT_DISPATCHER and dispatch the events its aggregate
 * raised — the seam is applied uniformly, not in just one flow.
 *
 * To go to production, replace ONLY this binding with the real bus adapter
 * (Kafka/SNS/etc.) that publishes the events so PIP caches invalidate within
 * seconds (FR-8). The application layer is unchanged — it depends on the port,
 * not this class.
 */
@Injectable()
export class LoggingDomainEventDispatcher implements IDomainEventDispatcher {
  private readonly logger = new Logger(LoggingDomainEventDispatcher.name);

  public dispatch(events: readonly DomainEvent[]): Promise<void> {
    for (const event of events) {
      this.logger.log(
        `domain event ${event.eventName()} for aggregate ${event.aggregateId.toString()} (placeholder dispatcher — bind a real event bus to invalidate PIP caches)`,
      );
    }
    return Promise.resolve();
  }
}

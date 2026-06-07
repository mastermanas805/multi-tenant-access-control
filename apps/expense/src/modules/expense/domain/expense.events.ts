import { DomainEvent, type UniqueEntityID } from '@kernel/core';

/**
 * Raised when an expense is approved (DESIGN §4.3 — money-movement transition).
 * A subscriber (out of scope here) would notify the payout pipeline / ledger.
 * The `approvedBy` is the actor from the verified identity context, and
 * `decisionId` links the transition to the allowing PDP decision (DESIGN §8.2).
 */
export class ExpenseApprovedEvent extends DomainEvent {
  public readonly approvedBy: string;
  public readonly decisionId: string;

  constructor(aggregateId: UniqueEntityID, approvedBy: string, decisionId: string) {
    super(aggregateId);
    this.approvedBy = approvedBy;
    this.decisionId = decisionId;
  }

  public eventName(): string {
    return 'expense.approved';
  }
}

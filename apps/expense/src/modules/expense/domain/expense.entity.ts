import { AggregateRoot, Guard, UniqueEntityID } from '@kernel/core';

import { ExpenseApprovedEvent } from './expense.events';
import { ExpenseStatusError } from './expense.errors';
import { ExpenseId } from './value-objects/expense-id.vo';

/** Lifecycle status of an expense report (mirrors the @contracts/core ExpenseStatus). */
export enum ExpenseStatus {
  Pending = 'pending',
  Approved = 'approved',
  Rejected = 'rejected',
}

/** Internal property bag for the Expense aggregate. */
export interface ExpenseProps {
  tenantId: string;
  amount: number;
  currency: string;
  department: string;
  ownerId: string;
  status: ExpenseStatus;
  description: string;
  /**
   * The org-tree scope path used to select the Cerbos policy chain
   * (e.g. `acme.finance`). The PEP passes it to the PDP so the most-specific
   * scoped policy decides (DESIGN §3.1, §8.5). Authoritatively the
   * `<tenant>.<department>` org path the resource lives under.
   */
  scope: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Input for creating a new expense. */
export interface CreateExpenseProps {
  id: string;
  tenantId: string;
  amount: number;
  currency: string;
  department: string;
  ownerId: string;
  description: string;
  scope: string;
  now: Date;
}

/** Snapshot used to rehydrate an expense from persistence (the mapper builds this). */
export interface ExpenseSnapshot {
  id: string;
  tenantId: string;
  amount: number;
  currency: string;
  department: string;
  ownerId: string;
  status: ExpenseStatus;
  description: string;
  scope: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Expense aggregate root (DESIGN §4.3, §13). Owns its lifecycle invariants and
 * raises a domain event for the money-movement transition (approve). The PEP
 * authorizes the transition BEFORE the use-case calls `approve` — the aggregate
 * only enforces that the transition is valid for the current status.
 */
export class Expense extends AggregateRoot<ExpenseProps> {
  private constructor(props: ExpenseProps, id: UniqueEntityID) {
    super(props, id);
  }

  // --- Factory (new aggregate) ------------------------------------------------

  public static create(props: CreateExpenseProps): Expense {
    const id = ExpenseId.fromString(props.id);
    Guard.againstEmpty(props.tenantId, 'tenantId');
    Guard.againstEmpty(props.currency, 'currency');
    Guard.againstEmpty(props.department, 'department');
    Guard.againstEmpty(props.ownerId, 'ownerId');
    Guard.againstEmpty(props.scope, 'scope');
    Guard.invariant(Number.isFinite(props.amount), 'amount must be a finite number', 'amount_invalid');
    Guard.invariant(props.amount >= 0, 'amount must be non-negative', 'amount_negative');
    Guard.invariant(props.description.length <= 1000, 'description too long', 'description_too_long');

    return new Expense(
      {
        tenantId: props.tenantId,
        amount: props.amount,
        currency: props.currency,
        department: props.department,
        ownerId: props.ownerId,
        status: ExpenseStatus.Pending,
        description: props.description,
        scope: props.scope,
        version: 1,
        createdAt: props.now,
        updatedAt: props.now,
      },
      new UniqueEntityID(id.toString()),
    );
  }

  // --- Rehydration (from persistence) ----------------------------------------

  public static fromSnapshot(snapshot: ExpenseSnapshot): Expense {
    return new Expense(
      {
        tenantId: snapshot.tenantId,
        amount: snapshot.amount,
        currency: snapshot.currency,
        department: snapshot.department,
        ownerId: snapshot.ownerId,
        status: snapshot.status,
        description: snapshot.description,
        scope: snapshot.scope,
        version: snapshot.version,
        createdAt: snapshot.createdAt,
        updatedAt: snapshot.updatedAt,
      },
      new UniqueEntityID(snapshot.id),
    );
  }

  // --- Getters ---------------------------------------------------------------

  public get expenseId(): ExpenseId {
    return ExpenseId.fromString(this.id.toString());
  }

  public get tenantId(): string {
    return this.props.tenantId;
  }

  public get amount(): number {
    return this.props.amount;
  }

  public get currency(): string {
    return this.props.currency;
  }

  public get department(): string {
    return this.props.department;
  }

  public get ownerId(): string {
    return this.props.ownerId;
  }

  public get status(): ExpenseStatus {
    return this.props.status;
  }

  public get description(): string {
    return this.props.description;
  }

  public get scope(): string {
    return this.props.scope;
  }

  public get version(): number {
    return this.props.version;
  }

  public get createdAt(): Date {
    return this.props.createdAt;
  }

  public get updatedAt(): Date {
    return this.props.updatedAt;
  }

  // --- Behavior (invariant-protected transitions) ----------------------------

  /**
   * Approves a pending expense. Authorization is enforced by the PEP BEFORE this
   * is reached; here we only enforce the state machine. Idempotent re-approval is
   * rejected to surface caller bugs / replays. Raises ExpenseApprovedEvent.
   */
  public approve(approvedBy: string, decisionId: string, now: Date): void {
    if (this.props.status === ExpenseStatus.Approved) {
      throw new ExpenseStatusError('Expense is already approved', 'expense_already_approved');
    }
    if (this.props.status === ExpenseStatus.Rejected) {
      throw new ExpenseStatusError('Cannot approve a rejected expense', 'expense_rejected');
    }
    this.props.status = ExpenseStatus.Approved;
    this.touch(now);
    this.addDomainEvent(new ExpenseApprovedEvent(this.id, approvedBy, decisionId));
  }

  private touch(now: Date): void {
    this.props.updatedAt = now;
    this.props.version += 1;
  }
}

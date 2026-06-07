import { Expense, type ExpenseStatus } from '../domain/expense.entity';
import { ExpenseOrmEntity } from './expense.orm-entity';

/**
 * Translates between the Expense aggregate and its TypeORM row. The only place
 * that knows both shapes, keeping the domain free of persistence concerns.
 *
 * `amount` is stored as Postgres `numeric` (exact) and surfaced by the driver as
 * a string; it is parsed to a JS number at this boundary and serialized back.
 */
export const ExpenseMapper = {
  /** Aggregate -> ORM row (for persistence). */
  toOrm(expense: Expense): ExpenseOrmEntity {
    const orm = new ExpenseOrmEntity();
    orm.id = expense.id.toString();
    orm.tenantId = expense.tenantId;
    orm.amount = expense.amount.toFixed(2);
    orm.currency = expense.currency;
    orm.department = expense.department;
    orm.ownerId = expense.ownerId;
    orm.status = expense.status;
    orm.description = expense.description;
    orm.scope = expense.scope;
    orm.version = expense.version;
    orm.createdAt = expense.createdAt;
    orm.updatedAt = expense.updatedAt;
    return orm;
  },

  /** ORM row -> aggregate (rehydration via the aggregate's snapshot factory). */
  toDomain(orm: ExpenseOrmEntity): Expense {
    return Expense.fromSnapshot({
      id: orm.id,
      tenantId: orm.tenantId,
      amount: Number(orm.amount),
      currency: orm.currency,
      department: orm.department,
      ownerId: orm.ownerId,
      status: orm.status as ExpenseStatus,
      description: orm.description,
      scope: orm.scope,
      version: orm.version,
      createdAt: orm.createdAt,
      updatedAt: orm.updatedAt,
    });
  },
} as const;

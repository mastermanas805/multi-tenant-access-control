import { Module } from '@nestjs/common';

import { ApproveExpenseUseCase } from './application/use-cases/approve-expense.use-case';
import { ListAuthorizedExpensesUseCase } from './application/use-cases/list-authorized-expenses.use-case';
import { EXPENSE_REPOSITORY } from './domain/expense.repository.port';
import { TypeOrmExpenseRepository } from './infrastructure/typeorm-expense.repository';
import { ExpenseController } from './presentation/expense.controller';
import { ExpenseResourceLoader } from './presentation/expense-resource.loader';

/**
 * Wires the Expense feature module (the worked PEP example):
 *   - controller (presentation) + the ExpenseResourceLoader the @Authorize
 *     decorator delegates to;
 *   - use-cases (application): approve + authorization-aware list;
 *   - the repository PORT token -> its TypeORM adapter (infrastructure).
 *
 * The PDP/PIP/Audit clients come from the GLOBAL AuthzModule (imported in
 * AppModule via forRootAsync); CLOCK + DOMAIN_EVENT_DISPATCHER +
 * IdentityTenantContextGuard come from the global SharedModule; DATA_SOURCE +
 * TenantContextService from the global DatabaseModule.
 */
@Module({
  controllers: [ExpenseController],
  providers: [
    ApproveExpenseUseCase,
    ListAuthorizedExpensesUseCase,
    ExpenseResourceLoader,
    { provide: EXPENSE_REPOSITORY, useClass: TypeOrmExpenseRepository },
  ],
  exports: [EXPENSE_REPOSITORY],
})
export class ExpenseModule {}

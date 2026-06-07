import { Inject, Injectable } from '@nestjs/common';

import { type LoadedResource, type ResourceLoaderContext } from '@authz/pep';

import { type ExpenseRepository, EXPENSE_REPOSITORY } from '../domain/expense.repository.port';
import { ExpenseId } from '../domain/value-objects/expense-id.vo';

/**
 * The ONLY domain-specific code the PEP needs: HOW to load an expense + the attrs
 * the policy references (DESIGN §3.5/§3.6). The `@Authorize` decorator's
 * `loadResource` is evaluated at class-definition time, so it cannot reference the
 * controller instance; instead it delegates to this injectable singleton via a
 * module-scoped holder (see `expenseResourceLoaderHolder` below). That keeps the
 * loader fully DI-wired (it gets the repository) while satisfying the decorator's
 * static-closure constraint.
 *
 * Reads from the service's OWN db, in-request and always FRESH (DESIGN §3.5) —
 * resource attributes are never cached. RLS (via the bound tenant context) scopes
 * the read; the PEP's tenant guardrail is the second check.
 */
@Injectable()
export class ExpenseResourceLoader {
  constructor(@Inject(EXPENSE_REPOSITORY) private readonly expenses: ExpenseRepository) {
    // Register this singleton so the decorator's static loadResource can reach it.
    expenseResourceLoaderHolder.instance = this;
  }

  public async load({ request }: ResourceLoaderContext): Promise<LoadedResource | null> {
    const idParam = request.params.id;
    if (idParam === undefined) {
      return null;
    }
    const id = ExpenseId.fromString(idParam);
    const expense = await this.expenses.findById(id);
    if (expense === null) {
      return null;
    }
    return {
      id: expense.id.toString(),
      // `scope` selects the Cerbos policy chain for this resource (e.g.
      // `acme.finance`), so the most-specific scoped policy decides (DESIGN §8.5).
      scope: expense.scope,
      attr: {
        // tenantId drives the PEP's cheap tenant guardrail (DESIGN §6); the rest
        // are the ABAC/ownership inputs the policy references (DESIGN §3.1).
        tenantId: expense.tenantId,
        amount: expense.amount,
        department: expense.department,
        ownerId: expense.ownerId,
      },
    };
  }
}

/**
 * Module-scoped holder bridging the @Authorize static closure to the DI-wired
 * loader singleton. NestJS providers are singletons, so the instance set in the
 * loader's constructor is the one used for every request. Fail-closed: the
 * decorator's loadResource returns null (-> 404) when the loader is not yet wired.
 */
export const expenseResourceLoaderHolder: { instance: ExpenseResourceLoader | null } = {
  instance: null,
};

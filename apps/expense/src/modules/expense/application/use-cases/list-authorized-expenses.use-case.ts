import { Inject, Injectable } from '@nestjs/common';

import { EXPENSE_RESOURCE_KIND } from '@contracts/core';
import {
  type DecisionAuditRecord,
  type EffectivePrincipal,
  type PdpPrincipal,
  type PdpResource,
} from '@contracts/core';
import { PageQuery } from '@kernel/core';
import {
  AUDIT_SINK,
  type AuditSink,
  CerbosPdpClient,
  PIP_CLIENT,
  type PipClient,
} from '@authz/pep';

import { type Expense } from '../../domain/expense.entity';
import { type ExpenseRepository, EXPENSE_REPOSITORY } from '../../domain/expense.repository.port';
import { type ListAuthorizedExpensesQuery } from '../dto/expense.commands';
import { type ExpensePageView, type ExpenseView, toExpenseView } from '../dto/expense.view';

/**
 * Authorization-aware listing of expenses (DESIGN §8.2 — "return only what the
 * principal may read"). This is the LIST-side counterpart of the per-route PEP
 * guard, expressed as an application use-case because it must filter a SET of
 * resources rather than guard one:
 *
 *   1. RLS layer (cheap, in the DB): the repository runs inside the tenant-scoped
 *      transaction, so the candidate set is already only THIS tenant's expenses
 *      (DESIGN §6 layer 1) — no cross-tenant row ever reaches the PDP.
 *   2. PDP layer (per-resource ABAC): for each candidate we resolve the
 *      principal's effective roles/attrs for that expense's policy SCOPE (the PIP,
 *      cached read-through) and ask Cerbos whether `read` is ALLOWed; only ALLOWs
 *      are returned. Every decision (allow AND deny) is emitted to the AuditSink.
 *
 * NOTE on filtering strategy: Cerbos offers a PlanResources (query-planning) API
 * that returns a filter expression to push down to the data store, which scales
 * better than N point-checks. The shared `@authz/pep` PDP client wraps only
 * `checkResource` today, so we filter POST-LOAD with a per-resource `read` check.
 * The page is bounded (cursor `limit`) and the PIP single-flights + caches the
 * per-scope resolve, so the fan-out is small; swapping in PlanResources is a
 * drop-in optimization behind this use-case (the controller contract is unchanged).
 */
@Injectable()
export class ListAuthorizedExpensesUseCase {
  constructor(
    @Inject(EXPENSE_REPOSITORY) private readonly expenses: ExpenseRepository,
    private readonly pdp: CerbosPdpClient,
    @Inject(PIP_CLIENT) private readonly pip: PipClient,
    @Inject(AUDIT_SINK) private readonly audit: AuditSink,
  ) {}

  public async execute(query: ListAuthorizedExpensesQuery): Promise<ExpensePageView> {
    const page = PageQuery.from({ limit: query.limit, cursor: query.cursor });
    const candidates = await this.expenses.list(page);

    const visible: ExpenseView[] = [];
    // Cache the per-scope effective principal within this request so we do not
    // re-resolve the same (user, tenant, scope) for every expense on the page.
    const effectiveByScope = new Map<string, EffectivePrincipal>();

    for (const expense of candidates.items) {
      const allowed = await this.canRead(query, expense, effectiveByScope);
      if (allowed) {
        visible.push(toExpenseView(expense));
      }
    }

    return { items: visible, nextCursor: candidates.nextCursor };
  }

  private async canRead(
    query: ListAuthorizedExpensesQuery,
    expense: Expense,
    effectiveByScope: Map<string, EffectivePrincipal>,
  ): Promise<boolean> {
    const effective = await this.resolveEffective(query, expense.scope, effectiveByScope);

    const principal: PdpPrincipal = {
      id: query.principalId,
      roles: effective.roles,
      attr: { ...effective.attr, tenantId: query.tenantId },
    };
    const resource: PdpResource = {
      kind: EXPENSE_RESOURCE_KIND,
      id: expense.id.toString(),
      attr: {
        tenantId: expense.tenantId,
        amount: expense.amount,
        department: expense.department,
        ownerId: expense.ownerId,
      },
    };

    const decision = await this.pdp.check(principal, resource, ['read'], expense.scope);
    const result = decision.results[0];
    const effect = result?.effect ?? 'DENY';

    this.emitAudit(query, decision.decisionId, resource, 'read', effect, result?.policy, result?.reason);
    return effect === 'ALLOW';
  }

  private async resolveEffective(
    query: ListAuthorizedExpensesQuery,
    scope: string,
    effectiveByScope: Map<string, EffectivePrincipal>,
  ): Promise<EffectivePrincipal> {
    const cached = effectiveByScope.get(scope);
    if (cached) {
      return cached;
    }
    // `read` is a low-risk action: the PIP's bounded-staleness cache is acceptable
    // (no forceFresh), unlike the sensitive `approve` route (DESIGN §3.5, §9.1).
    const effective = await this.pip.resolve(query.principalId, query.tenantId, scope, false);
    effectiveByScope.set(scope, effective);
    return effective;
  }

  private emitAudit(
    query: ListAuthorizedExpensesQuery,
    decisionId: string,
    resource: PdpResource,
    action: string,
    effect: 'ALLOW' | 'DENY',
    policy: string | undefined,
    reason: string | undefined,
  ): void {
    const record: DecisionAuditRecord = {
      decisionId,
      traceId: query.traceId,
      tenantId: query.tenantId,
      principalId: query.principalId,
      actorId: query.actorId,
      resourceKind: resource.kind,
      resourceId: resource.id,
      action,
      effect,
      ...(policy ? { policy } : {}),
      ...(reason ? { reason } : {}),
      decidedAt: new Date().toISOString(),
    };
    this.audit.record(record);
  }
}

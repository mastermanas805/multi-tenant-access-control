import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { type Request } from 'express';

import { EXPENSE_RESOURCE_KIND } from '@contracts/core';
import {
  AuthzGuard,
  Authorize,
  IdentityContextMiddleware,
  type LoadedResource,
  type ResourceLoaderContext,
} from '@authz/pep';

import { IdentityTenantContextGuard } from '../../../shared/presentation/identity-tenant-context.guard';
import { ApproveExpenseUseCase } from '../application/use-cases/approve-expense.use-case';
import { ListAuthorizedExpensesUseCase } from '../application/use-cases/list-authorized-expenses.use-case';
import { ApproveExpenseRequestDto } from './dto/approve-expense.request';
import { ApproveExpenseResponseDto, ExpensePageResponse } from './dto/expense.response';
import { expenseResourceLoaderHolder } from './expense-resource.loader';
import { ListExpensesQueryDto } from './dto/list-expenses.query';

/**
 * THIN HTTP adapter for the Expense aggregate — the worked PEP example
 * (DESIGN §3.2, §4.3). Every route runs behind:
 *   - IdentityContextMiddleware (applied in AppModule): verifies the internal
 *     identity token and populates `req.authzPrincipal` (DESIGN §5, §7);
 *   - IdentityTenantContextGuard: binds the token tenant id into the DB tenant
 *     context so the RlsInterceptor scopes every query (DESIGN §6 layer 1).
 *
 * The approve route ADDS the @authz/pep AuthzGuard + @Authorize, which loads the
 * resource, runs the cheap tenant guardrail, resolves the principal via the PIP,
 * calls the Cerbos PDP, audits the decision, and on DENY throws a ForbiddenError
 * the global filter renders as the §8.1 envelope (reason + decisionId).
 */
@ApiTags('expenses')
@ApiBearerAuth()
@ApiHeader({
  name: IdentityContextMiddleware.TOKEN_HEADER,
  description:
    'base64url JSON of the internal identity token {sub,tid,actorId,sessionId} — placeholder for the gateway-minted signed JWT (DESIGN §7).',
  required: true,
})
@Controller({ path: 'expenses', version: '1' })
export class ExpenseController {
  constructor(
    private readonly approveExpense: ApproveExpenseUseCase,
    private readonly listAuthorizedExpenses: ListAuthorizedExpensesUseCase,
  ) {}

  /**
   * Approve an expense — the money-movement PEP flow (DESIGN §4.3, §8.2).
   *
   * `sensitive: true` forces a FRESH PIP read (no cache) so a just-revoked role is
   * enforced immediately (DESIGN §3.5, §9.1). `loadResource` delegates to the
   * DI-wired ExpenseResourceLoader (the decorator runs at class-definition time
   * and cannot see the instance) to return the resource attrs the policy
   * references (tenantId for the guardrail, amount/department for the ABAC
   * condition, ownerId for ownership) and the `scope` that selects the policy
   * chain (e.g. `acme.finance`). On ALLOW the guard exposes the decisionId; on
   * DENY it throws a ForbiddenError (-> 403 envelope).
   */
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(IdentityTenantContextGuard, AuthzGuard)
  @Authorize({
    action: 'approve',
    resourceKind: EXPENSE_RESOURCE_KIND,
    sensitive: true,
    loadResource: (ctx: ResourceLoaderContext): Promise<LoadedResource | null> => {
      const loader = expenseResourceLoaderHolder.instance;
      // Fail-closed: a not-yet-wired loader yields null (-> 404), never an allow.
      return loader ? loader.load(ctx) : Promise.resolve(null);
    },
  })
  @ApiOperation({ summary: 'Approve an expense (PEP-enforced; returns the decisionId)' })
  @ApiOkResponse({ type: ApproveExpenseResponseDto })
  public async approve(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() _body: ApproveExpenseRequestDto,
  ): Promise<ApproveExpenseResponseDto> {
    // The guard set this on ALLOW (it would have thrown 403 on a DENY).
    const decisionId = req.authzDecision?.decisionId ?? '';
    const approvedBy = req.authzPrincipal?.actorId ?? '';

    const view = await this.approveExpense.execute({
      expenseId: id,
      approvedBy,
      decisionId,
    });
    return ApproveExpenseResponseDto.from(view);
  }

  /**
   * Authorization-aware listing (DESIGN §8.2): returns ONLY the expenses the
   * principal may `read`. RLS scopes the candidate set to the tenant (layer 1);
   * the use-case then PDP-checks `read` per expense and keeps the ALLOWs, auditing
   * each decision. No AuthzGuard here — the guard authorizes a SINGLE resource;
   * set-filtering is the use-case's job.
   */
  @Get()
  @UseGuards(IdentityTenantContextGuard)
  @ApiOperation({ summary: 'List the expenses the caller may read (PDP-filtered)' })
  @ApiOkResponse({ type: ExpensePageResponse })
  public async list(
    @Req() req: Request,
    @Query() query: ListExpensesQueryDto,
  ): Promise<ExpensePageResponse> {
    const principal = req.authzPrincipal;
    const view = await this.listAuthorizedExpenses.execute({
      principalId: principal?.principalId ?? '',
      tenantId: principal?.tenantId ?? '',
      actorId: principal?.actorId ?? '',
      traceId: req.traceId ?? '',
      limit: query.limit,
      cursor: query.cursor,
    });
    return ExpensePageResponse.from(view);
  }
}

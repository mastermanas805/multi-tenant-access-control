import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { type Request } from 'express';

import { ListAuditEventsUseCase } from '../application/use-cases/list-audit-events.use-case';
import { RecordAuditEventUseCase } from '../application/use-cases/record-audit-event.use-case';
import { VerifyChainUseCase } from '../application/use-cases/verify-chain.use-case';
import { AuditEventPageResponse, AuditEventResponse } from './dto/audit-event.response';
import { ChainVerificationResponse } from './dto/chain-verification.response';
import { ListAuditEventsQueryDto } from './dto/list-audit-events.query';
import { RecordAuditEventRequest } from './dto/record-audit-event.request';

/**
 * THIN HTTP adapter for the append-only audit log (DESIGN §10 / App. C).
 * Controllers ONLY translate the request DTO into a command, invoke a single
 * use-case, and map the view into a response. No business logic here.
 *
 * AuthN/Z:
 *   - INGEST (POST): in production sits behind mTLS/SPIFFE so only trusted PEPs may
 *     append (DESIGN §7/§10). The PEP's fire-and-forget AuditSink posts with NO
 *     internal identity token, so this route is excluded from the verifying
 *     middleware; the hash chain is the in-band integrity guarantee.
 *   - READ (GET): mounted behind the PEP's IdentityContextMiddleware, which VERIFIES
 *     the gateway-signed internal token. The decision log is scoped to the caller's
 *     VERIFIED tenant (`tid`) — a client-supplied `?tenantId=` that does not match is
 *     REJECTED (403), so a holder of a tenant-A JWT cannot read tenant B's decision
 *     log. Only a VERIFIED platform-admin may read cross-tenant (DESIGN §6/§7).
 */
@ApiTags('audit')
@ApiBearerAuth()
@Controller({ path: 'audit/events', version: '1' })
export class AuditEventController {
  constructor(
    private readonly recordEvent: RecordAuditEventUseCase,
    private readonly listEvents: ListAuditEventsUseCase,
    private readonly verifyChain: VerifyChainUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Append a decision/admin event to the tamper-evident log' })
  @ApiCreatedResponse({ type: AuditEventResponse })
  public async record(@Body() body: RecordAuditEventRequest): Promise<AuditEventResponse> {
    const view = await this.recordEvent.execute({
      id: body.id,
      tenantId: body.tenantId,
      actor: body.actor,
      action: body.action,
      decision: body.decision,
      resourceKind: body.resourceKind,
      resourceId: body.resourceId,
      reason: body.reason,
      policy: body.policy,
      decisionId: body.decisionId,
      traceId: body.traceId,
      occurredAt: body.at,
    });
    return AuditEventResponse.from(view);
  }

  @Get()
  @ApiOperation({
    summary: "List audit events (cursor pagination), scoped to the caller's verified tenant",
  })
  @ApiOkResponse({ type: AuditEventPageResponse })
  public async list(
    @Query() query: ListAuditEventsQueryDto,
    @Req() req: Request,
  ): Promise<AuditEventPageResponse> {
    const view = await this.listEvents.execute({
      tenantId: this.resolveReadTenant(req, query.tenantId),
      limit: query.limit,
      cursor: query.cursor,
    });
    return AuditEventPageResponse.from(view);
  }

  /**
   * Resolves the tenant the decision-log read is scoped to from the VERIFIED
   * principal (DESIGN §6/§7) — never trusting the client `?tenantId=` for scoping:
   *  - no verified principal  -> 401 (fail-closed; the middleware should have set it);
   *  - platform-admin         -> may read ANY tenant: honor an explicit `?tenantId=`
   *                              (or all tenants when omitted);
   *  - regular principal      -> ALWAYS scoped to the verified `tid`; a `?tenantId=`
   *                              that does not match the verified tenant is rejected
   *                              (403) rather than silently widened or narrowed.
   */
  private resolveReadTenant(req: Request, requestedTenantId?: string): string | undefined {
    const principal = req.authzPrincipal;
    if (!principal) {
      throw new UnauthorizedException('No authenticated principal context on the request');
    }
    if (principal.platformAdmin) {
      // Cross-tenant read allowed for a verified platform-admin: honor the filter as
      // given (undefined -> all tenants).
      return requestedTenantId;
    }
    if (requestedTenantId !== undefined && requestedTenantId !== principal.tenantId) {
      throw new ForbiddenException('Cannot read another tenant’s decision log');
    }
    return principal.tenantId;
  }

  @Get('verify')
  @ApiOperation({ summary: 'Replay the hash chain and report whether it is intact (tamper check)' })
  @ApiOkResponse({ type: ChainVerificationResponse })
  public async verify(): Promise<ChainVerificationResponse> {
    const view = await this.verifyChain.execute();
    return ChainVerificationResponse.from(view);
  }
}

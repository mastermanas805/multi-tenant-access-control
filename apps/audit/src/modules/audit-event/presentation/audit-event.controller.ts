import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

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
 * AuthN/Z note: in production the ingest endpoint sits behind mTLS/SPIFFE so only
 * trusted PEPs may append (DESIGN §7/§10), and the read endpoint behind the admin
 * JWT scope for the decision-explainer. Those edge controls are out of scope for
 * this reference slice; the hash chain is the in-band integrity guarantee.
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
  @ApiOperation({ summary: 'List audit events (cursor pagination), filterable by tenant' })
  @ApiOkResponse({ type: AuditEventPageResponse })
  public async list(@Query() query: ListAuditEventsQueryDto): Promise<AuditEventPageResponse> {
    const view = await this.listEvents.execute({
      tenantId: query.tenantId,
      limit: query.limit,
      cursor: query.cursor,
    });
    return AuditEventPageResponse.from(view);
  }

  @Get('verify')
  @ApiOperation({ summary: 'Replay the hash chain and report whether it is intact (tamper check)' })
  @ApiOkResponse({ type: ChainVerificationResponse })
  public async verify(): Promise<ChainVerificationResponse> {
    const view = await this.verifyChain.execute();
    return ChainVerificationResponse.from(view);
  }
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';

import { AuditDecision } from '../../domain/value-objects/audit-decision.vo';

/**
 * HTTP request body for POST /v1/audit/events. Transport-level validation only;
 * the domain re-validates and computes the hash.
 *
 * Shape matches the SPEC payload {tenantId, actor, action, decision, resource,
 * reason, decisionId, traceId, at} and the shared `DecisionAuditRecord`
 * (@contracts/core): a PEP posts the same fields it carries.
 */
export class RecordAuditEventRequest {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Stable event id used as the idempotency key (defaults to a new UUID).',
  })
  @IsOptional()
  @IsUUID()
  public id?: string;

  @ApiProperty({ format: 'uuid', description: 'Tenant the event belongs to (audit is tenant-scoped).' })
  @IsUUID()
  public tenantId!: string;

  @ApiProperty({ example: 'riya', description: 'The acting principal/actor id (the JWT sub/actorId).' })
  @IsString()
  @Length(1, 255)
  public actor!: string;

  @ApiProperty({ example: 'approve', description: 'The action that was decided/performed.' })
  @IsString()
  @Length(1, 255)
  public action!: string;

  @ApiProperty({
    enum: AuditDecision,
    description: 'Decision outcome: ALLOW/DENY for decisions, N/A for admin/PAP changes.',
  })
  @IsIn(Object.values(AuditDecision))
  public decision!: AuditDecision;

  @ApiProperty({ example: 'expense_report', description: 'The resource kind acted upon.' })
  @IsString()
  @Length(1, 255)
  public resourceKind!: string;

  @ApiProperty({ example: 'exp_123', description: 'The resource id acted upon.' })
  @IsString()
  @Length(1, 255)
  public resourceId!: string;

  @ApiPropertyOptional({ description: 'The deciding rule/condition in human terms.' })
  @IsOptional()
  @IsString()
  @Length(0, 1024)
  public reason?: string;

  @ApiPropertyOptional({
    example: 'expense_report/acme.finance',
    description: 'The deciding policy id (DESIGN §8.2).',
  })
  @IsOptional()
  @IsString()
  @Length(0, 512)
  public policy?: string;

  @ApiPropertyOptional({ description: 'The PDP decision id this event records (DESIGN §8.2).' })
  @IsOptional()
  @IsString()
  @Length(0, 255)
  public decisionId?: string;

  @ApiPropertyOptional({ description: 'Correlation/trace id linking the event across services.' })
  @IsOptional()
  @IsString()
  @Length(0, 255)
  public traceId?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'ISO-8601 instant the decision/change occurred. Defaults to receipt time.',
  })
  @IsOptional()
  @IsISO8601()
  public at?: string;
}

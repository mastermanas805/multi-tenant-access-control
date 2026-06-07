import { ApiProperty } from '@nestjs/swagger';

import {
  type AuditEventPageView,
  type AuditEventView,
} from '../../application/dto/audit-event.view';

/** Swagger-documented response shape for a single recorded audit event. */
export class AuditEventResponse {
  @ApiProperty({ format: 'uuid' })
  public id!: string;

  @ApiProperty({ description: 'Chain position (gap-free, total order).' })
  public seq!: number;

  @ApiProperty({ format: 'uuid' })
  public tenantId!: string;

  @ApiProperty()
  public actor!: string;

  @ApiProperty()
  public action!: string;

  @ApiProperty({ enum: ['ALLOW', 'DENY', 'N/A'] })
  public decision!: string;

  @ApiProperty()
  public resourceKind!: string;

  @ApiProperty()
  public resourceId!: string;

  @ApiProperty({ nullable: true })
  public reason!: string | null;

  @ApiProperty({ nullable: true })
  public policy!: string | null;

  @ApiProperty({ nullable: true })
  public decisionId!: string | null;

  @ApiProperty({ nullable: true })
  public traceId!: string | null;

  @ApiProperty({ format: 'date-time' })
  public occurredAt!: string;

  @ApiProperty({ format: 'date-time' })
  public recordedAt!: string;

  @ApiProperty({ description: 'Hash of the previous record (chain link).' })
  public prevHash!: string;

  @ApiProperty({ description: 'sha256(prevHash || canonical(event)) — the chain hash.' })
  public recordHash!: string;

  public static from(view: AuditEventView): AuditEventResponse {
    return Object.assign(new AuditEventResponse(), view);
  }
}

/** Swagger-documented paged response shape. */
export class AuditEventPageResponse {
  @ApiProperty({ type: [AuditEventResponse] })
  public items!: AuditEventResponse[];

  @ApiProperty({ nullable: true, description: 'Cursor for the next page, or null.' })
  public nextCursor!: string | null;

  @ApiProperty()
  public hasMore!: boolean;

  public static from(view: AuditEventPageView): AuditEventPageResponse {
    const res = new AuditEventPageResponse();
    res.items = view.items.map((item) => AuditEventResponse.from(item));
    res.nextCursor = view.nextCursor;
    res.hasMore = view.hasMore;
    return res;
  }
}

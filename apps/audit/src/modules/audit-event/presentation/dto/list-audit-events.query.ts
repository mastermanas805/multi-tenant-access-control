import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

import { MAX_PAGE_LIMIT } from '@kernel/core';

/** Query string for GET /v1/audit/events (cursor pagination — DESIGN §8.1). */
export class ListAuditEventsQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Filter to a single tenant.' })
  @IsOptional()
  @IsUUID()
  public tenantId?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_LIMIT, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  public limit?: number;

  @ApiPropertyOptional({ description: 'Opaque cursor from a previous page' })
  @IsOptional()
  @IsString()
  public cursor?: string;
}

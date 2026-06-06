import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

import { MAX_PAGE_LIMIT } from '@kernel/core';

/** Query string for GET /v1/org-units (subtree listing — DESIGN §8.5, §8.1). */
export class ListSubtreeQueryDto {
  @ApiProperty({
    example: 'acme.finance',
    description: 'Materialized path of the subtree root (the root itself + descendants).',
  })
  @IsString()
  @Length(1, 1024)
  public rootPath!: string;

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

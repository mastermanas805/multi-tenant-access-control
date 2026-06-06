import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

import { MAX_PAGE_LIMIT } from '@kernel/core';

/** Query string for GET /v1/role-assignments (cursor pagination — DESIGN §8.1). */
export class ListAssignmentsQueryDto {
  @ApiPropertyOptional({
    example: 'user_riya',
    description: 'External user id to list assignments for.',
  })
  @IsString()
  @Length(1, 255)
  public userId!: string;

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

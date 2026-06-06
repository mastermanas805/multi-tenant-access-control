import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

/**
 * HTTP request body for POST /v1/org-units/:id/move.
 * Omitting `newParentId` (or sending null) promotes the node to a root.
 */
export class MoveOrgUnitRequest {
  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'New parent org-unit id. Omit/null to promote the node to a root.',
  })
  @IsOptional()
  @IsUUID()
  public newParentId?: string | null;
}

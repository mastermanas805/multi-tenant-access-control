import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';

/**
 * HTTP request body for POST /v1/roles/:id/permissions (grant). The same shape
 * is reused conceptually for revoke, where the permission is in the path.
 */
export class AddPermissionRequest {
  @ApiProperty({
    example: 'expense:report:approve',
    maxLength: 255,
    description: 'Permission key in service:resource:action form (DESIGN §3, FR-4).',
  })
  @IsString()
  @Length(1, 255)
  @Matches(/^[a-z0-9]+(?::[a-z0-9*]+){2}$/, {
    message: 'permission must be in service:resource:action form',
  })
  public permission!: string;
}

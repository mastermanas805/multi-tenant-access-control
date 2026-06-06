import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';

/** HTTP request body for POST /v1/permissions. Transport-level validation only. */
export class CreatePermissionRequest {
  @ApiProperty({
    example: 'expense:report:approve',
    description: 'Capability key formatted service:resource:action (lower snake-case).',
  })
  @IsString()
  @Length(1, 150)
  @Matches(/^[a-z0-9_]+:[a-z0-9_]+:[a-z0-9_]+$/, {
    message: 'key must match service:resource:action (lower snake-case)',
  })
  public key!: string;

  @ApiProperty({ example: 'Approve an expense report', maxLength: 500 })
  @IsString()
  @Length(1, 500)
  public description!: string;
}

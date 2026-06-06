import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsOptional, IsString, Length, Matches } from 'class-validator';

/** HTTP request body for POST /v1/roles. Transport-level validation only. */
export class CreateRoleRequest {
  @ApiProperty({
    example: 'finance_manager',
    maxLength: 100,
    description: 'snake_case, unique per tenant (DESIGN §8 roles(tenant_id,key) unique)',
  })
  @IsString()
  @Length(1, 100)
  @Matches(/^[a-z0-9]+(?:_[a-z0-9]+)*$/, { message: 'key must be snake_case' })
  public key!: string;

  @ApiProperty({
    example: 'acme.finance',
    maxLength: 255,
    description: 'Dotted org-path scope (DESIGN §3 hierarchical scopes).',
  })
  @IsString()
  @Length(1, 255)
  @Matches(/^[a-z0-9]+(?:\.[a-z0-9]+)*$/, { message: 'scope must be a dotted org path' })
  public scope!: string;

  @ApiPropertyOptional({ example: 'Approves finance expense reports', maxLength: 500 })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  public description?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['expense:report:read', 'expense:report:approve'],
    description: 'Permission keys in service:resource:action form (DESIGN §3, FR-4).',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/^[a-z0-9]+(?::[a-z0-9*]+){2}$/, {
    each: true,
    message: 'permission must be in service:resource:action form',
  })
  public permissions?: string[];
}

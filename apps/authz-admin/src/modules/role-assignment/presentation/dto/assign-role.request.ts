import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, Length, Matches } from 'class-validator';

const SCOPE_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*(?:\.[a-z0-9]+(?:_[a-z0-9]+)*)*$/;

// NOTE: `delegatedBy` is intentionally NOT a field here. It is a security/audit
// attribute and is stamped server-side from the authenticated caller's identity
// (the JWT `sub` claim — the `x-actor-id` placeholder header captured by
// TenantContextGuard), never accepted from the client body, so a caller cannot
// forge who delegated a privileged grant (DESIGN §6).

/** HTTP request body for POST /v1/role-assignments. Transport-level validation only. */
export class AssignRoleRequest {
  @ApiProperty({
    example: 'user_riya',
    maxLength: 255,
    description: 'External user id (uuid or string)',
  })
  @IsString()
  @Length(1, 255)
  public userId!: string;

  @ApiProperty({ example: 'role_7f3', maxLength: 255, description: 'Role id to assign' })
  @IsString()
  @Length(1, 255)
  public roleId!: string;

  @ApiProperty({
    example: 'acme.finance.emea',
    description: 'Hierarchical org-unit scope path (dot-delimited, DESIGN §8.5).',
  })
  @IsString()
  @Length(1, 255)
  @Matches(SCOPE_PATTERN, { message: 'scope must be a dot-delimited lowercase path' })
  public scope!: string;

  @ApiPropertyOptional({
    example: '2026-12-31T23:59:59.000Z',
    description: 'Optional expiry for delegated/time-boxed grants (ISO-8601).',
  })
  @IsOptional()
  @IsISO8601()
  public validUntil?: string;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Length, Matches } from 'class-validator';

import { IsolationTierValue } from '../../domain/value-objects/isolation-tier.vo';

/** HTTP request body for POST /v1/tenants. Transport-level validation only. */
export class CreateTenantRequest {
  @ApiProperty({ example: 'Acme Corporation', maxLength: 200 })
  @IsString()
  @Length(1, 200)
  public name!: string;

  @ApiProperty({ example: 'acme', description: 'kebab-case, unique per platform' })
  @IsString()
  @Length(1, 100)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'slug must be kebab-case' })
  public slug!: string;

  @ApiPropertyOptional({
    enum: IsolationTierValue,
    default: IsolationTierValue.Pool,
    description: 'Data-isolation tier (DESIGN §6). Defaults to pool.',
  })
  @IsOptional()
  @IsEnum(IsolationTierValue)
  public isolationTier?: IsolationTierValue;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';

/** HTTP request body for POST /v1/org-units. Transport-level validation only. */
export class CreateOrgUnitRequest {
  @ApiProperty({
    example: 'finance',
    description: 'lower-kebab leaf segment; becomes the path suffix under the parent',
  })
  @IsString()
  @Length(1, 63)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'segment must be lower-kebab-case' })
  public segment!: string;

  @ApiProperty({ example: 'Finance', maxLength: 200 })
  @IsString()
  @Length(1, 200)
  public name!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Parent org-unit id. Omit to create a root node.',
  })
  @IsOptional()
  @IsUUID()
  public parentId?: string;
}

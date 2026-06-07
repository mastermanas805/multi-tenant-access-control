import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';

/**
 * Query string for GET /v1/principals/:userId/effective. The `tenantId` is
 * validated here for the contract (and echoed in Swagger) but the authoritative
 * tenant comes from the ambient context (the JWT `tid` placeholder header), never
 * the query — DESIGN §6. `scope` is the org-tree path to resolve inheritance
 * against (DESIGN §8.5).
 */
export class ResolvePrincipalQueryDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'Active tenant context (DESIGN §6). Provided for the PEP/HttpPipClient contract; the server authoritatively uses the ambient tenant from the verified token.',
  })
  @IsString()
  @Length(1, 255)
  public tenantId!: string;

  @ApiProperty({
    example: 'acme.finance',
    description: 'Org-tree scope to resolve role inheritance against (DESIGN §8.5).',
  })
  @IsString()
  @Length(1, 255)
  @Matches(/^[a-z0-9]+(?:\.[a-z0-9]+)*$/, {
    message: 'scope must be a dot-separated path of lowercase alphanumeric segments',
  })
  public scope!: string;
}

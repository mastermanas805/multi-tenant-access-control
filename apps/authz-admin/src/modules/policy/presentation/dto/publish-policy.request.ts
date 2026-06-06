import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, IsObject, IsString, Length, Matches } from 'class-validator';

/** HTTP request body for POST /v1/policies. Transport-level validation only. */
export class PublishPolicyRequest {
  @ApiProperty({
    example: 'acme.finance',
    description: 'Org-tree path scope (DESIGN §8.5); maps 1:1 to a Cerbos scope.',
  })
  @IsString()
  @Length(1, 255)
  @Matches(/^[a-z0-9]+(?:\.[a-z0-9]+)*$/, {
    message: 'scope must be a dot-separated path of lowercase alphanumeric segments',
  })
  public scope!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Opaque JSON policy rule body (DESIGN §8.3 JSONB).',
    example: { effect: 'ALLOW', condition: 'amount < 10000' },
  })
  @IsObject()
  public rule!: Record<string, unknown>;

  @ApiProperty({
    format: 'date-time',
    example: '2026-07-01T00:00:00.000Z',
    description: 'When the policy version takes effect (DESIGN §8.2).',
  })
  @IsISO8601()
  public effectiveDate!: string;
}

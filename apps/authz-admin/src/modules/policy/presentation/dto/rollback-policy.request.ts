import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

/** HTTP request body for POST /v1/policies/:id/rollback (DESIGN §8.2). */
export class RollbackPolicyRequest {
  @ApiProperty({
    example: 6,
    minimum: 1,
    description: 'The previously-published version whose rule is republished.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  public toVersion!: number;
}

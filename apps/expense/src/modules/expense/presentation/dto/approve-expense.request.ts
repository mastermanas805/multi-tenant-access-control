import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** HTTP request body for POST /v1/expenses/:id/approve. Transport-level validation only. */
export class ApproveExpenseRequestDto {
  @ApiPropertyOptional({
    description: 'Optional approver comment, recorded with the approval.',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  public comment?: string;
}

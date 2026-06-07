import { ApiProperty } from '@nestjs/swagger';

import { type ApproveExpenseResponse, type ExpenseStatus } from '@contracts/core';

import { type ExpensePageView, type ExpenseView } from '../../application/dto/expense.view';

/** Swagger-documented response shape for a single expense (the §8.2 ExpenseDto). */
export class ExpenseResponse {
  @ApiProperty({ example: 'exp_42' })
  public id!: string;

  @ApiProperty({ format: 'uuid' })
  public tenantId!: string;

  @ApiProperty({ example: 8500 })
  public amount!: number;

  @ApiProperty({ example: 'USD' })
  public currency!: string;

  @ApiProperty({ example: 'finance' })
  public department!: string;

  @ApiProperty({ example: 'riya' })
  public ownerId!: string;

  @ApiProperty({ enum: ['pending', 'approved', 'rejected'] })
  public status!: ExpenseStatus;

  @ApiProperty()
  public description!: string;

  @ApiProperty({ format: 'date-time' })
  public createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  public updatedAt!: string;

  public static from(view: ExpenseView): ExpenseResponse {
    return Object.assign(new ExpenseResponse(), view);
  }
}

/** Swagger-documented paged response shape (authorization-aware list, §8.2). */
export class ExpensePageResponse {
  @ApiProperty({ type: [ExpenseResponse] })
  public items!: ExpenseResponse[];

  @ApiProperty({ nullable: true, description: 'Cursor for the next page, or null.' })
  public nextCursor!: string | null;

  public static from(view: ExpensePageView): ExpensePageResponse {
    const res = new ExpensePageResponse();
    res.items = view.items.map((item) => ExpenseResponse.from(item));
    res.nextCursor = view.nextCursor;
    return res;
  }
}

/** Swagger-documented response for a successful approve (DESIGN §8.2). */
export class ApproveExpenseResponseDto {
  @ApiProperty({ example: 'exp_42' })
  public id!: string;

  @ApiProperty({ enum: ['pending', 'approved', 'rejected'], example: 'approved' })
  public status!: ExpenseStatus;

  @ApiProperty({ example: 'riya', description: 'The actor who approved (verified identity).' })
  public approvedBy!: string;

  @ApiProperty({
    example: 'dec_8f1c…',
    description: 'The allowing PDP decision id, for audit correlation (DESIGN §8.2).',
  })
  public decisionId!: string;

  @ApiProperty({ format: 'date-time' })
  public at!: string;

  public static from(view: ApproveExpenseResponse): ApproveExpenseResponseDto {
    return Object.assign(new ApproveExpenseResponseDto(), view);
  }
}

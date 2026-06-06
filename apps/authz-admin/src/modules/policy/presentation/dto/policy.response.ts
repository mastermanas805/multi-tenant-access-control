import { ApiProperty } from '@nestjs/swagger';

import { type PolicyPageView, type PolicyView } from '../../application/dto/policy.view';

/** Swagger-documented response shape for a single policy. */
export class PolicyResponse {
  @ApiProperty({ format: 'uuid' })
  public id!: string;

  @ApiProperty({ format: 'uuid' })
  public tenantId!: string;

  @ApiProperty({ example: 'acme.finance' })
  public scope!: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  public rule!: Record<string, unknown>;

  @ApiProperty({ enum: ['staged', 'active'] })
  public status!: string;

  @ApiProperty({ description: 'Monotonic policy version (also the ETag).' })
  public version!: number;

  @ApiProperty({ format: 'date-time' })
  public effectiveDate!: string;

  @ApiProperty({ format: 'date-time' })
  public createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  public updatedAt!: string;

  public static from(view: PolicyView): PolicyResponse {
    return Object.assign(new PolicyResponse(), view);
  }
}

/** Swagger-documented paged response shape. */
export class PolicyPageResponse {
  @ApiProperty({ type: [PolicyResponse] })
  public items!: PolicyResponse[];

  @ApiProperty({ nullable: true, description: 'Cursor for the next page, or null.' })
  public nextCursor!: string | null;

  @ApiProperty()
  public hasMore!: boolean;

  public static from(view: PolicyPageView): PolicyPageResponse {
    const res = new PolicyPageResponse();
    res.items = view.items.map((item) => PolicyResponse.from(item));
    res.nextCursor = view.nextCursor;
    res.hasMore = view.hasMore;
    return res;
  }
}

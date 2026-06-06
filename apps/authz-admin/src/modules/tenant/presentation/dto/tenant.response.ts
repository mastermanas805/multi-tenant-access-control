import { ApiProperty } from '@nestjs/swagger';

import { type TenantPageView, type TenantView } from '../../application/dto/tenant.view';

/** Swagger-documented response shape for a single tenant. */
export class TenantResponse {
  @ApiProperty({ format: 'uuid' })
  public id!: string;

  @ApiProperty()
  public name!: string;

  @ApiProperty()
  public slug!: string;

  @ApiProperty({ enum: ['active', 'suspended'] })
  public status!: string;

  @ApiProperty({ enum: ['pool', 'bridge', 'silo'] })
  public isolationTier!: string;

  @ApiProperty({ description: 'Optimistic-concurrency version (also the ETag).' })
  public version!: number;

  @ApiProperty({ format: 'date-time' })
  public createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  public updatedAt!: string;

  public static from(view: TenantView): TenantResponse {
    return Object.assign(new TenantResponse(), view);
  }
}

/** Swagger-documented paged response shape. */
export class TenantPageResponse {
  @ApiProperty({ type: [TenantResponse] })
  public items!: TenantResponse[];

  @ApiProperty({ nullable: true, description: 'Cursor for the next page, or null.' })
  public nextCursor!: string | null;

  @ApiProperty()
  public hasMore!: boolean;

  public static from(view: TenantPageView): TenantPageResponse {
    const res = new TenantPageResponse();
    res.items = view.items.map((item) => TenantResponse.from(item));
    res.nextCursor = view.nextCursor;
    res.hasMore = view.hasMore;
    return res;
  }
}

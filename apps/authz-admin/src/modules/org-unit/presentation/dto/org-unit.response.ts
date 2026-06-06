import { ApiProperty } from '@nestjs/swagger';

import { type OrgUnitPageView, type OrgUnitView } from '../../application/dto/org-unit.view';

/** Swagger-documented response shape for a single org-unit. */
export class OrgUnitResponse {
  @ApiProperty({ format: 'uuid' })
  public id!: string;

  @ApiProperty({ format: 'uuid' })
  public tenantId!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  public parentId!: string | null;

  @ApiProperty({ example: 'acme.finance.emea', description: 'Materialized path (Cerbos scope).' })
  public path!: string;

  @ApiProperty()
  public name!: string;

  @ApiProperty({ description: 'Optimistic-concurrency version (also the ETag).' })
  public version!: number;

  @ApiProperty({ format: 'date-time' })
  public createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  public updatedAt!: string;

  public static from(view: OrgUnitView): OrgUnitResponse {
    return Object.assign(new OrgUnitResponse(), view);
  }
}

/** Swagger-documented paged response shape. */
export class OrgUnitPageResponse {
  @ApiProperty({ type: [OrgUnitResponse] })
  public items!: OrgUnitResponse[];

  @ApiProperty({ nullable: true, description: 'Cursor for the next page, or null.' })
  public nextCursor!: string | null;

  @ApiProperty()
  public hasMore!: boolean;

  public static from(view: OrgUnitPageView): OrgUnitPageResponse {
    const res = new OrgUnitPageResponse();
    res.items = view.items.map((item) => OrgUnitResponse.from(item));
    res.nextCursor = view.nextCursor;
    res.hasMore = view.hasMore;
    return res;
  }
}

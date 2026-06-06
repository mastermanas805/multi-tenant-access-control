import { ApiProperty } from '@nestjs/swagger';

import { type RolePageView, type RoleView } from '../../application/dto/role.view';

/** Swagger-documented response shape for a single role. */
export class RoleResponse {
  @ApiProperty({ format: 'uuid' })
  public id!: string;

  @ApiProperty({ format: 'uuid' })
  public tenantId!: string;

  @ApiProperty({ example: 'finance_manager' })
  public key!: string;

  @ApiProperty({ example: 'acme.finance' })
  public scope!: string;

  @ApiProperty()
  public description!: string;

  @ApiProperty({ type: [String], example: ['expense:report:read', 'expense:report:approve'] })
  public permissions!: string[];

  @ApiProperty({ description: 'Optimistic-concurrency version (also the ETag).' })
  public version!: number;

  @ApiProperty({ format: 'date-time' })
  public createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  public updatedAt!: string;

  public static from(view: RoleView): RoleResponse {
    return Object.assign(new RoleResponse(), view);
  }
}

/** Swagger-documented paged response shape. */
export class RolePageResponse {
  @ApiProperty({ type: [RoleResponse] })
  public items!: RoleResponse[];

  @ApiProperty({ nullable: true, description: 'Cursor for the next page, or null.' })
  public nextCursor!: string | null;

  @ApiProperty()
  public hasMore!: boolean;

  public static from(view: RolePageView): RolePageResponse {
    const res = new RolePageResponse();
    res.items = view.items.map((item) => RoleResponse.from(item));
    res.nextCursor = view.nextCursor;
    res.hasMore = view.hasMore;
    return res;
  }
}

import { ApiProperty } from '@nestjs/swagger';

import {
  type PermissionPageView,
  type PermissionView,
} from '../../application/dto/permission.view';

/** Swagger-documented response shape for a single permission. */
export class PermissionResponse {
  @ApiProperty({ format: 'uuid' })
  public id!: string;

  @ApiProperty({ example: 'expense:report:approve' })
  public key!: string;

  @ApiProperty()
  public description!: string;

  @ApiProperty({ description: 'Optimistic-concurrency version (also the ETag).' })
  public version!: number;

  @ApiProperty({ format: 'date-time' })
  public createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  public updatedAt!: string;

  public static from(view: PermissionView): PermissionResponse {
    return Object.assign(new PermissionResponse(), view);
  }
}

/** Swagger-documented paged response shape. */
export class PermissionPageResponse {
  @ApiProperty({ type: [PermissionResponse] })
  public items!: PermissionResponse[];

  @ApiProperty({ nullable: true, description: 'Cursor for the next page, or null.' })
  public nextCursor!: string | null;

  @ApiProperty()
  public hasMore!: boolean;

  public static from(view: PermissionPageView): PermissionPageResponse {
    const res = new PermissionPageResponse();
    res.items = view.items.map((item) => PermissionResponse.from(item));
    res.nextCursor = view.nextCursor;
    res.hasMore = view.hasMore;
    return res;
  }
}

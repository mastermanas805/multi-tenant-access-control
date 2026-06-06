import { ApiProperty } from '@nestjs/swagger';

import {
  type RoleAssignmentPageView,
  type RoleAssignmentView,
} from '../../application/dto/role-assignment.view';

/** Swagger-documented response shape for a single role assignment. */
export class RoleAssignmentResponse {
  @ApiProperty({ format: 'uuid' })
  public id!: string;

  @ApiProperty({ format: 'uuid' })
  public tenantId!: string;

  @ApiProperty()
  public userId!: string;

  @ApiProperty()
  public roleId!: string;

  @ApiProperty({ example: 'acme.finance.emea' })
  public scope!: string;

  @ApiProperty({ enum: ['active', 'revoked'] })
  public status!: string;

  @ApiProperty({ format: 'date-time', nullable: true })
  public validUntil!: string | null;

  @ApiProperty({ nullable: true })
  public delegatedBy!: string | null;

  @ApiProperty({ description: 'Optimistic-concurrency version (also the ETag).' })
  public version!: number;

  @ApiProperty({ format: 'date-time' })
  public createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  public updatedAt!: string;

  public static from(view: RoleAssignmentView): RoleAssignmentResponse {
    return Object.assign(new RoleAssignmentResponse(), view);
  }
}

/** Swagger-documented paged response shape. */
export class RoleAssignmentPageResponse {
  @ApiProperty({ type: [RoleAssignmentResponse] })
  public items!: RoleAssignmentResponse[];

  @ApiProperty({ nullable: true, description: 'Cursor for the next page, or null.' })
  public nextCursor!: string | null;

  @ApiProperty()
  public hasMore!: boolean;

  public static from(view: RoleAssignmentPageView): RoleAssignmentPageResponse {
    const res = new RoleAssignmentPageResponse();
    res.items = view.items.map((item) => RoleAssignmentResponse.from(item));
    res.nextCursor = view.nextCursor;
    res.hasMore = view.hasMore;
    return res;
  }
}

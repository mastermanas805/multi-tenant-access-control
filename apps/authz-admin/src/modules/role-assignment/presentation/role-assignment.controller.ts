import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { TenantContextService } from '../../../shared/infrastructure/database/tenant-context';
import { TenantContextGuard } from '../../../shared/presentation/tenant-context.guard';
import { AssignRoleUseCase } from '../application/use-cases/assign-role.use-case';
import { ListAssignmentsForUserUseCase } from '../application/use-cases/list-assignments-for-user.use-case';
import { RevokeRoleUseCase } from '../application/use-cases/revoke-role.use-case';
import { AssignRoleRequest } from './dto/assign-role.request';
import { ListAssignmentsQueryDto } from './dto/list-assignments.query';
import { RoleAssignmentPageResponse, RoleAssignmentResponse } from './dto/role-assignment.response';

/**
 * THIN HTTP adapter for the RoleAssignment aggregate. Controllers ONLY:
 *   1. translate the request DTO into an application command,
 *   2. invoke a single use-case,
 *   3. map the view into a response DTO.
 * No business logic lives here. The TenantContextGuard establishes the tenant
 * context (placeholder JWT tid -> x-tenant-id header) for the whole module; the
 * tenant id is read from that ambient context (DESIGN §8.1 — never from the body).
 */
@ApiTags('role-assignments')
@ApiBearerAuth()
@ApiHeader({
  name: TenantContextGuard.TENANT_HEADER,
  description: 'Tenant UUID — placeholder for the verified JWT tid claim (DESIGN §6).',
  required: true,
})
@UseGuards(TenantContextGuard)
@Controller({ path: 'role-assignments', version: '1' })
export class RoleAssignmentController {
  constructor(
    private readonly assignRole: AssignRoleUseCase,
    private readonly revokeRole: RevokeRoleUseCase,
    private readonly listAssignmentsForUser: ListAssignmentsForUserUseCase,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Assign a role to a user at a scope' })
  @ApiHeader({
    name: 'idempotency-key',
    description: 'Required for mutations (DESIGN §8.1).',
    required: false,
  })
  @ApiHeader({
    name: TenantContextGuard.ACTOR_HEADER,
    description:
      'Caller identity — placeholder for the verified JWT sub claim (DESIGN §6). Stamped as the assignment delegatedBy server-side; never read from the body.',
    required: false,
  })
  @ApiCreatedResponse({ type: RoleAssignmentResponse })
  public async assign(@Body() body: AssignRoleRequest): Promise<RoleAssignmentResponse> {
    const view = await this.assignRole.execute({
      tenantId: this.tenantContext.getTenantId(),
      userId: body.userId,
      roleId: body.roleId,
      scope: body.scope,
      validUntil: body.validUntil ?? null,
      // delegatedBy is the AUTHENTICATED CALLER's identity (the JWT `sub`
      // placeholder), stamped server-side — never read from the body — so the
      // delegator on a privileged grant cannot be forged (DESIGN §6).
      delegatedBy: this.tenantContext.getActorId(),
    });
    return RoleAssignmentResponse.from(view);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: "List a user's role assignments (cursor pagination)" })
  @ApiOkResponse({ type: RoleAssignmentPageResponse })
  public async list(@Query() query: ListAssignmentsQueryDto): Promise<RoleAssignmentPageResponse> {
    const view = await this.listAssignmentsForUser.execute({
      userId: query.userId,
      limit: query.limit,
      cursor: query.cursor,
    });
    return RoleAssignmentPageResponse.from(view);
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Revoke a role assignment (emits RoleAssignmentRevoked; optimistic concurrency via If-Match)',
  })
  @ApiHeader({
    name: 'if-match',
    description: 'Expected version ETag (DESIGN §8.1 optimistic concurrency).',
    required: false,
  })
  @ApiOkResponse({ type: RoleAssignmentResponse })
  public async revoke(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('if-match') ifMatch?: string,
  ): Promise<RoleAssignmentResponse> {
    const view = await this.revokeRole.execute({
      roleAssignmentId: id,
      expectedVersion: parseEtag(ifMatch),
    });
    return RoleAssignmentResponse.from(view);
  }
}

/** Parses a numeric version out of an `If-Match` ETag like `"3"` or `3`. */
function parseEtag(ifMatch?: string): number | undefined {
  if (!ifMatch) {
    return undefined;
  }
  const numeric = Number(ifMatch.replace(/"/g, '').trim());
  return Number.isInteger(numeric) ? numeric : undefined;
}

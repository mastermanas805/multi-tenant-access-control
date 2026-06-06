import {
  Body,
  Controller,
  Delete,
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
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { TenantContextService } from '../../../shared/infrastructure/database/tenant-context';
import { TenantContextGuard } from '../../../shared/presentation/tenant-context.guard';
import { AddPermissionToRoleUseCase } from '../application/use-cases/add-permission-to-role.use-case';
import { CreateRoleUseCase } from '../application/use-cases/create-role.use-case';
import { GetRoleUseCase } from '../application/use-cases/get-role.use-case';
import { ListRolesUseCase } from '../application/use-cases/list-roles.use-case';
import { RemovePermissionFromRoleUseCase } from '../application/use-cases/remove-permission-from-role.use-case';
import { CreateRoleRequest } from './dto/create-role.request';
import { ListRolesQueryDto } from './dto/list-roles.query';
import { AddPermissionRequest } from './dto/role-permission.request';
import { RolePageResponse, RoleResponse } from './dto/role.response';

/**
 * THIN HTTP adapter for the Role aggregate (DESIGN §8 PAP /v1/roles). Controllers
 * ONLY: translate the request DTO into an application command, invoke a single
 * use-case, and map the view into a response DTO. No business logic lives here.
 *
 * The TenantContextGuard establishes the tenant context (placeholder JWT tid ->
 * x-tenant-id header) for the whole module; create reads it back to stamp the new
 * role's tenant_id (the tenant is ambient, never taken from the body — DESIGN §8).
 */
@ApiTags('roles')
@ApiBearerAuth()
@ApiHeader({
  name: TenantContextGuard.TENANT_HEADER,
  description: 'Tenant UUID — placeholder for the verified JWT tid claim (DESIGN §6).',
  required: true,
})
@UseGuards(TenantContextGuard)
@Controller({ path: 'roles', version: '1' })
export class RoleController {
  constructor(
    private readonly createRole: CreateRoleUseCase,
    private readonly getRole: GetRoleUseCase,
    private readonly listRoles: ListRolesUseCase,
    private readonly addPermission: AddPermissionToRoleUseCase,
    private readonly removePermission: RemovePermissionFromRoleUseCase,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a role' })
  @ApiHeader({
    name: 'idempotency-key',
    description: 'Required for mutations (DESIGN §8.1).',
    required: false,
  })
  @ApiCreatedResponse({ type: RoleResponse })
  public async create(@Body() body: CreateRoleRequest): Promise<RoleResponse> {
    const view = await this.createRole.execute({
      tenantId: this.tenantContext.getTenantId(),
      key: body.key,
      scope: body.scope,
      description: body.description,
      permissions: body.permissions,
    });
    return RoleResponse.from(view);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Get a role by id (ETag = version)' })
  @ApiOkResponse({ type: RoleResponse })
  public async getById(@Param('id', new ParseUUIDPipe()) id: string): Promise<RoleResponse> {
    const view = await this.getRole.execute({ roleId: id });
    return RoleResponse.from(view);
  }

  @Get()
  @ApiOperation({ summary: 'List roles (cursor pagination)' })
  @ApiOkResponse({ type: RolePageResponse })
  public async list(@Query() query: ListRolesQueryDto): Promise<RolePageResponse> {
    const view = await this.listRoles.execute({
      limit: query.limit,
      cursor: query.cursor,
    });
    return RolePageResponse.from(view);
  }

  @Post(':id/permissions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Grant a permission to a role (optimistic concurrency via If-Match)' })
  @ApiHeader({
    name: 'if-match',
    description: 'Expected version ETag (DESIGN §8.1 optimistic concurrency).',
    required: false,
  })
  @ApiOkResponse({ type: RoleResponse })
  public async grantPermission(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: AddPermissionRequest,
    @Headers('if-match') ifMatch?: string,
  ): Promise<RoleResponse> {
    const view = await this.addPermission.execute({
      roleId: id,
      permission: body.permission,
      expectedVersion: parseEtag(ifMatch),
    });
    return RoleResponse.from(view);
  }

  @Delete(':id/permissions/:permission')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Revoke a permission from a role (optimistic concurrency via If-Match)',
  })
  @ApiParam({
    name: 'permission',
    example: 'expense:report:approve',
    description: 'Permission key in service:resource:action form.',
  })
  @ApiHeader({
    name: 'if-match',
    description: 'Expected version ETag (DESIGN §8.1 optimistic concurrency).',
    required: false,
  })
  @ApiOkResponse({ type: RoleResponse })
  public async revokePermission(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('permission') permission: string,
    @Headers('if-match') ifMatch?: string,
  ): Promise<RoleResponse> {
    const view = await this.removePermission.execute({
      roleId: id,
      permission,
      expectedVersion: parseEtag(ifMatch),
    });
    return RoleResponse.from(view);
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

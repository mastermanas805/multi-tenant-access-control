import {
  Body,
  Controller,
  Get,
  Header,
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

import { PlatformAdminGuard } from '../../../shared/presentation/platform-admin.guard';
import { TenantContextGuard } from '../../../shared/presentation/tenant-context.guard';
import { CreatePermissionUseCase } from '../application/use-cases/create-permission.use-case';
import { GetPermissionUseCase } from '../application/use-cases/get-permission.use-case';
import { ListPermissionsUseCase } from '../application/use-cases/list-permissions.use-case';
import { CreatePermissionRequest } from './dto/create-permission.request';
import { ListPermissionsQueryDto } from './dto/list-permissions.query';
import { PermissionPageResponse, PermissionResponse } from './dto/permission.response';

/**
 * THIN HTTP adapter for the GLOBAL permission catalog. Controllers ONLY:
 *   1. translate the request DTO into an application command,
 *   2. invoke a single use-case,
 *   3. map the view into a response DTO.
 * No business logic lives here. The catalog itself is platform-wide (no RLS), so
 * the TenantContextGuard establishes context for every route, but WRITES are gated
 * by the PlatformAdminGuard: the catalog is shared by every tenant, so letting any
 * tenant POST a permission would let one tenant pollute capability keys used by
 * all (a platform-integrity breach). Reads stay broadly available (DESIGN §6 /
 * App. A; finding-driven).
 */
@ApiTags('permissions')
@ApiBearerAuth()
@ApiHeader({
  name: TenantContextGuard.TENANT_HEADER,
  description: 'Tenant UUID — placeholder for the verified JWT tid claim (DESIGN §6).',
  required: true,
})
@UseGuards(TenantContextGuard)
@Controller({ path: 'permissions', version: '1' })
export class PermissionController {
  constructor(
    private readonly createPermission: CreatePermissionUseCase,
    private readonly getPermission: GetPermissionUseCase,
    private readonly listPermissions: ListPermissionsUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PlatformAdminGuard)
  @ApiOperation({ summary: 'Register a permission in the global catalog (platform-admin only)' })
  @ApiHeader({
    name: TenantContextGuard.PLATFORM_ADMIN_HEADER,
    description:
      'Platform-admin scope — placeholder for the verified JWT scope/role claim. Required to write the shared global catalog (DESIGN §6 / App. A).',
    required: true,
  })
  @ApiHeader({
    name: 'idempotency-key',
    description: 'Required for mutations (DESIGN §8.1).',
    required: false,
  })
  @ApiCreatedResponse({ type: PermissionResponse })
  public async create(@Body() body: CreatePermissionRequest): Promise<PermissionResponse> {
    const view = await this.createPermission.execute({
      key: body.key,
      description: body.description,
    });
    return PermissionResponse.from(view);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Get a permission by id (ETag = version)' })
  @ApiOkResponse({ type: PermissionResponse })
  public async getById(@Param('id', new ParseUUIDPipe()) id: string): Promise<PermissionResponse> {
    const view = await this.getPermission.execute({ permissionId: id });
    return PermissionResponse.from(view);
  }

  @Get()
  @ApiOperation({ summary: 'List permissions (cursor pagination)' })
  @ApiOkResponse({ type: PermissionPageResponse })
  public async list(@Query() query: ListPermissionsQueryDto): Promise<PermissionPageResponse> {
    const view = await this.listPermissions.execute({
      limit: query.limit,
      cursor: query.cursor,
    });
    return PermissionPageResponse.from(view);
  }
}

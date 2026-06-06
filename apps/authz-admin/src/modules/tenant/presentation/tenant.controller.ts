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

import { PlatformAdminGuard } from '../../../shared/presentation/platform-admin.guard';
import { TenantContextGuard } from '../../../shared/presentation/tenant-context.guard';
import { CreateTenantUseCase } from '../application/use-cases/create-tenant.use-case';
import { GetTenantUseCase } from '../application/use-cases/get-tenant.use-case';
import { ListTenantsUseCase } from '../application/use-cases/list-tenants.use-case';
import { SuspendTenantUseCase } from '../application/use-cases/suspend-tenant.use-case';
import { CreateTenantRequest } from './dto/create-tenant.request';
import { ListTenantsQueryDto } from './dto/list-tenants.query';
import { SuspendTenantRequest } from './dto/suspend-tenant.request';
import { TenantPageResponse, TenantResponse } from './dto/tenant.response';

/**
 * THIN HTTP adapter for the Tenant aggregate. Controllers ONLY:
 *   1. translate the request DTO into an application command,
 *   2. invoke a single use-case,
 *   3. map the view into a response DTO.
 * No business logic lives here. The TenantContextGuard establishes the tenant
 * context (placeholder JWT tid -> x-tenant-id header); the PlatformAdminGuard then
 * authorizes — tenant lifecycle is a PLATFORM-ADMIN surface, NOT per-tenant
 * self-service. The `tenants` table is global (no RLS), so without this gate any
 * tenant could read, enumerate, suspend or create OTHER tenants (a cross-tenant
 * confidentiality/integrity/availability breach). DESIGN §6 / App. A.
 */
@ApiTags('tenants')
@ApiBearerAuth()
@ApiHeader({
  name: TenantContextGuard.TENANT_HEADER,
  description: 'Tenant UUID — placeholder for the verified JWT tid claim (DESIGN §6).',
  required: true,
})
@ApiHeader({
  name: TenantContextGuard.PLATFORM_ADMIN_HEADER,
  description:
    'Platform-admin scope — placeholder for the verified JWT scope/role claim. Required: tenant lifecycle is platform-admin-only (DESIGN §6 / App. A).',
  required: true,
})
@UseGuards(TenantContextGuard, PlatformAdminGuard)
@Controller({ path: 'tenants', version: '1' })
export class TenantController {
  constructor(
    private readonly createTenant: CreateTenantUseCase,
    private readonly getTenant: GetTenantUseCase,
    private readonly listTenants: ListTenantsUseCase,
    private readonly suspendTenant: SuspendTenantUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a tenant' })
  @ApiHeader({
    name: 'idempotency-key',
    description: 'Required for mutations (DESIGN §8.1).',
    required: false,
  })
  @ApiCreatedResponse({ type: TenantResponse })
  public async create(@Body() body: CreateTenantRequest): Promise<TenantResponse> {
    const view = await this.createTenant.execute({
      name: body.name,
      slug: body.slug,
      isolationTier: body.isolationTier,
    });
    return TenantResponse.from(view);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Get a tenant by id (ETag = version)' })
  @ApiOkResponse({ type: TenantResponse })
  public async getById(@Param('id', new ParseUUIDPipe()) id: string): Promise<TenantResponse> {
    const view = await this.getTenant.execute({ tenantId: id });
    return TenantResponse.from(view);
  }

  @Get()
  @ApiOperation({ summary: 'List tenants (cursor pagination)' })
  @ApiOkResponse({ type: TenantPageResponse })
  public async list(@Query() query: ListTenantsQueryDto): Promise<TenantPageResponse> {
    const view = await this.listTenants.execute({
      limit: query.limit,
      cursor: query.cursor,
    });
    return TenantPageResponse.from(view);
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspend a tenant (optimistic concurrency via If-Match)' })
  @ApiHeader({
    name: 'if-match',
    description: 'Expected version ETag (DESIGN §8.1 optimistic concurrency).',
    required: false,
  })
  @ApiOkResponse({ type: TenantResponse })
  public async suspend(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: SuspendTenantRequest,
    @Headers('if-match') ifMatch?: string,
  ): Promise<TenantResponse> {
    const view = await this.suspendTenant.execute({
      tenantId: id,
      reason: body.reason,
      expectedVersion: parseEtag(ifMatch),
    });
    return TenantResponse.from(view);
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

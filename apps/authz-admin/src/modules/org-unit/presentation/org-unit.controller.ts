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

import { TenantContextGuard } from '../../../shared/presentation/tenant-context.guard';
import { CreateOrgUnitUseCase } from '../application/use-cases/create-org-unit.use-case';
import { GetOrgUnitUseCase } from '../application/use-cases/get-org-unit.use-case';
import { ListSubtreeUseCase } from '../application/use-cases/list-subtree.use-case';
import { MoveOrgUnitUseCase } from '../application/use-cases/move-org-unit.use-case';
import { CreateOrgUnitRequest } from './dto/create-org-unit.request';
import { ListSubtreeQueryDto } from './dto/list-subtree.query';
import { MoveOrgUnitRequest } from './dto/move-org-unit.request';
import { OrgUnitPageResponse, OrgUnitResponse } from './dto/org-unit.response';

/**
 * THIN HTTP adapter for the OrgUnit aggregate. Controllers ONLY:
 *   1. translate the request DTO into an application command,
 *   2. invoke a single use-case,
 *   3. map the view into a response DTO.
 * No business logic lives here. The TenantContextGuard establishes the tenant
 * context (placeholder JWT tid -> x-tenant-id header) for the whole module, and
 * RLS scopes every statement to that tenant.
 */
@ApiTags('org-units')
@ApiBearerAuth()
@ApiHeader({
  name: TenantContextGuard.TENANT_HEADER,
  description:
    'Signed internal identity token (gateway-injected, PEP-verified) carrying the tenant context (DESIGN §5/§6/§7).',
  required: true,
})
@UseGuards(TenantContextGuard)
@Controller({ path: 'org-units', version: '1' })
export class OrgUnitController {
  constructor(
    private readonly createOrgUnit: CreateOrgUnitUseCase,
    private readonly getOrgUnit: GetOrgUnitUseCase,
    private readonly listSubtree: ListSubtreeUseCase,
    private readonly moveOrgUnit: MoveOrgUnitUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an org-unit (path derived from parent)' })
  @ApiHeader({
    name: 'idempotency-key',
    description: 'Required for mutations (DESIGN §8.1).',
    required: false,
  })
  @ApiCreatedResponse({ type: OrgUnitResponse })
  public async create(@Body() body: CreateOrgUnitRequest): Promise<OrgUnitResponse> {
    const view = await this.createOrgUnit.execute({
      segment: body.segment,
      name: body.name,
      parentId: body.parentId,
    });
    return OrgUnitResponse.from(view);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Get an org-unit by id (ETag = version)' })
  @ApiOkResponse({ type: OrgUnitResponse })
  public async getById(@Param('id', new ParseUUIDPipe()) id: string): Promise<OrgUnitResponse> {
    const view = await this.getOrgUnit.execute({ orgUnitId: id });
    return OrgUnitResponse.from(view);
  }

  @Get()
  @ApiOperation({ summary: 'List an org-unit subtree (cursor pagination)' })
  @ApiOkResponse({ type: OrgUnitPageResponse })
  public async list(@Query() query: ListSubtreeQueryDto): Promise<OrgUnitPageResponse> {
    const view = await this.listSubtree.execute({
      rootPath: query.rootPath,
      limit: query.limit,
      cursor: query.cursor,
    });
    return OrgUnitPageResponse.from(view);
  }

  @Post(':id/move')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Move (re-parent) an org-unit, recomputing subtree paths' })
  @ApiHeader({
    name: 'if-match',
    description: 'Expected version ETag (DESIGN §8.1 optimistic concurrency).',
    required: false,
  })
  @ApiOkResponse({ type: OrgUnitResponse })
  public async move(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: MoveOrgUnitRequest,
    @Headers('if-match') ifMatch?: string,
  ): Promise<OrgUnitResponse> {
    const view = await this.moveOrgUnit.execute({
      orgUnitId: id,
      newParentId: body.newParentId ?? null,
      expectedVersion: parseEtag(ifMatch),
    });
    return OrgUnitResponse.from(view);
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

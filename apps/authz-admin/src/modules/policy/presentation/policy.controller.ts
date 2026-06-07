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
import { ActivatePolicyUseCase } from '../application/use-cases/activate-policy.use-case';
import { GetPolicyUseCase } from '../application/use-cases/get-policy.use-case';
import { ListPoliciesUseCase } from '../application/use-cases/list-policies.use-case';
import { PublishPolicyUseCase } from '../application/use-cases/publish-policy.use-case';
import { RollbackPolicyUseCase } from '../application/use-cases/rollback-policy.use-case';
import { ListPoliciesQueryDto } from './dto/list-policies.query';
import { PolicyPageResponse, PolicyResponse } from './dto/policy.response';
import { PublishPolicyRequest } from './dto/publish-policy.request';
import { RollbackPolicyRequest } from './dto/rollback-policy.request';

/**
 * THIN HTTP adapter for the Policy aggregate. Controllers ONLY:
 *   1. translate the request DTO into an application command,
 *   2. invoke a single use-case,
 *   3. map the view into a response DTO.
 * No business logic lives here. The TenantContextGuard establishes the tenant
 * context (placeholder JWT tid -> x-tenant-id header) for the whole module.
 */
@ApiTags('policies')
@ApiBearerAuth()
@ApiHeader({
  name: TenantContextGuard.TENANT_HEADER,
  description:
    'Signed internal identity token (gateway-injected, PEP-verified) carrying the tenant context (DESIGN §5/§6/§7).',
  required: true,
})
@UseGuards(TenantContextGuard)
@Controller({ path: 'policies', version: '1' })
export class PolicyController {
  constructor(
    private readonly publishPolicy: PublishPolicyUseCase,
    private readonly activatePolicy: ActivatePolicyUseCase,
    private readonly rollbackPolicy: RollbackPolicyUseCase,
    private readonly getPolicy: GetPolicyUseCase,
    private readonly listPolicies: ListPoliciesUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Publish a new policy version (status staged)' })
  @ApiHeader({
    name: 'idempotency-key',
    description: 'Required for mutations (DESIGN §8.1).',
    required: false,
  })
  @ApiCreatedResponse({ type: PolicyResponse })
  public async publish(@Body() body: PublishPolicyRequest): Promise<PolicyResponse> {
    const view = await this.publishPolicy.execute({
      scope: body.scope,
      rule: body.rule,
      effectiveDate: body.effectiveDate,
    });
    return PolicyResponse.from(view);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Get a policy by id (ETag = version)' })
  @ApiOkResponse({ type: PolicyResponse })
  public async getById(@Param('id', new ParseUUIDPipe()) id: string): Promise<PolicyResponse> {
    const view = await this.getPolicy.execute({ policyId: id });
    return PolicyResponse.from(view);
  }

  @Get()
  @ApiOperation({ summary: 'List policies (cursor pagination)' })
  @ApiOkResponse({ type: PolicyPageResponse })
  public async list(@Query() query: ListPoliciesQueryDto): Promise<PolicyPageResponse> {
    const view = await this.listPolicies.execute({
      limit: query.limit,
      cursor: query.cursor,
    });
    return PolicyPageResponse.from(view);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Activate a staged policy version (optimistic concurrency via If-Match)',
  })
  @ApiHeader({
    name: 'if-match',
    description: 'Expected version ETag (DESIGN §8.1 optimistic concurrency).',
    required: false,
  })
  @ApiOkResponse({ type: PolicyResponse })
  public async activate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('if-match') ifMatch?: string,
  ): Promise<PolicyResponse> {
    const view = await this.activatePolicy.execute({
      policyId: id,
      expectedVersion: parseEtag(ifMatch),
    });
    return PolicyResponse.from(view);
  }

  @Post(':id/rollback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Roll a policy scope back to a prior version (creates a new version)' })
  @ApiHeader({
    name: 'idempotency-key',
    description: 'Required for mutations (DESIGN §8.1).',
    required: false,
  })
  @ApiOkResponse({ type: PolicyResponse })
  public async rollback(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: RollbackPolicyRequest,
  ): Promise<PolicyResponse> {
    const view = await this.rollbackPolicy.execute({
      policyId: id,
      toVersion: body.toVersion,
    });
    return PolicyResponse.from(view);
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

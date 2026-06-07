import { Controller, Get, Header, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ResolvePrincipalUseCase } from '../application/use-cases/resolve-principal.use-case';
import { EffectivePrincipalResponse } from './dto/effective-principal.response';
import { ResolvePrincipalQueryDto } from './dto/resolve-principal.query';
import { PipTenantContextGuard } from './pip-tenant-context.guard';

/**
 * THIN HTTP adapter for the PIP principal-resolution endpoint (DESIGN §3.2 PIP,
 * §3.5). It exposes the read model the Expense PEP consumes via @authz/pep's
 * HttpPipClient:
 *
 *   GET /v1/principals/:userId/effective?tenantId=&scope=
 *
 * The controller ONLY translates the request into the query, invokes the single
 * use-case, and maps the view to the response DTO. PipTenantContextGuard binds the
 * tenant from the `tenantId` query (the service-to-service contract) so RLS scopes
 * the read (DESIGN §6).
 */
@ApiTags('principals')
@ApiBearerAuth()
@UseGuards(PipTenantContextGuard)
@Controller({ path: 'principals', version: '1' })
export class PrincipalController {
  constructor(private readonly resolvePrincipal: ResolvePrincipalUseCase) {}

  @Get(':userId/effective')
  // The PIP read is bounded-staleness cached BY THE CLIENT (HttpPipClient TTL+LRU,
  // DESIGN §9.1); the resource itself is always fresh, so forbid stale shared caches.
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: "Resolve a principal's effective roles + attributes for a (tenant, scope) context",
  })
  @ApiOkResponse({ type: EffectivePrincipalResponse })
  public async effective(
    @Param('userId') userId: string,
    @Query() query: ResolvePrincipalQueryDto,
  ): Promise<EffectivePrincipalResponse> {
    const view = await this.resolvePrincipal.execute({ userId, scope: query.scope });
    return EffectivePrincipalResponse.from(view);
  }
}

import { ApiProperty } from '@nestjs/swagger';

import { type PrincipalView } from '../../application/dto/principal.view';

/**
 * Swagger-documented response for GET /v1/principals/:userId/effective. Its shape
 * is the shared `EffectivePrincipal` contract (the PIP read model the Expense PEP
 * consumes via HttpPipClient — DESIGN §3.2, §3.5).
 */
export class EffectivePrincipalResponse {
  @ApiProperty({ example: 'riya', description: 'The principal (user) id this view is for.' })
  public id!: string;

  @ApiProperty({
    format: 'uuid',
    description: 'Owning tenant (must match the resource — DESIGN §6).',
  })
  public tenantId!: string;

  @ApiProperty({
    type: [String],
    example: ['finance_manager'],
    description: 'Effective role keys for the requested scope chain (most-specific-first).',
  })
  public roles!: string[];

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { tenantId: 'aaaaaaaa-0000-4000-8000-000000000001', department: 'finance' },
    description: 'Effective principal attributes (tenantId + best-effort department).',
  })
  public attr!: Record<string, unknown>;

  public static from(view: PrincipalView): EffectivePrincipalResponse {
    const res = new EffectivePrincipalResponse();
    res.id = view.id;
    res.tenantId = view.tenantId;
    res.roles = view.roles;
    res.attr = view.attr;
    return res;
  }
}

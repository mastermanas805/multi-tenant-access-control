import { Controller, Get, Header, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { GetJwksUseCase } from '../application/use-cases/get-jwks.use-case';
import { JwksResponse } from './dto/jwks.response';

/**
 * Publishes the OIDC JSON Web Key Set at the well-known path
 * `/.well-known/jwks.json` (DESIGN §5, §7). Version-NEUTRAL (no /v1 prefix) and
 * unauthenticated — it exposes ONLY the public verification key so the gateway
 * and every PEP can verify RS256 access tokens without contacting the IdP.
 * Cacheable (public keys rotate slowly), unlike the token endpoints.
 */
@ApiTags('oidc')
@Controller({ version: VERSION_NEUTRAL })
export class JwksController {
  constructor(private readonly getJwks: GetJwksUseCase) {}

  @Get('.well-known/jwks.json')
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOperation({ summary: 'Public JWKS for RS256 token verification' })
  @ApiOkResponse({ type: JwksResponse })
  public jwks(): JwksResponse {
    return JwksResponse.from(this.getJwks.execute());
  }
}

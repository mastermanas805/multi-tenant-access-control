import { Body, Controller, Header, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';

import { IssueTokenUseCase } from '../application/use-cases/issue-token.use-case';
import { RefreshTokenUseCase } from '../application/use-cases/refresh-token.use-case';
import { IssueTokenRequest } from './dto/issue-token.request';
import { RefreshTokenRequest } from './dto/refresh-token.request';
import { TokenResponse } from './dto/token.response';

/**
 * THIN HTTP adapter for the OIDC token endpoints (DESIGN §5). Controllers ONLY:
 *   1. translate the request DTO into an application command,
 *   2. invoke a single use-case,
 *   3. map the view into a response DTO.
 * No authentication logic lives here — it is the use-case's job. Responses are
 * `no-store` per OAuth 2.0 (tokens must never be cached).
 */
@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly issueToken: IssueTokenUseCase,
    private readonly refreshToken: RefreshTokenUseCase,
  ) {}

  @Post('token')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  @ApiOperation({ summary: 'Password grant — issue an access + refresh token pair' })
  @ApiOkResponse({ type: TokenResponse })
  @ApiUnauthorizedResponse({ description: 'Invalid email or password (§8.1 envelope).' })
  public async token(@Body() body: IssueTokenRequest): Promise<TokenResponse> {
    const view = await this.issueToken.execute({
      email: body.email,
      password: body.password,
    });
    return TokenResponse.from(view);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  @ApiOperation({ summary: 'Refresh grant — rotate a refresh token for a new pair' })
  @ApiOkResponse({ type: TokenResponse })
  @ApiUnauthorizedResponse({ description: 'Invalid or expired refresh token (§8.1 envelope).' })
  public async refresh(@Body() body: RefreshTokenRequest): Promise<TokenResponse> {
    const view = await this.refreshToken.execute({ refreshToken: body.refreshToken });
    return TokenResponse.from(view);
  }
}

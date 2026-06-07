import { ApiProperty } from '@nestjs/swagger';

import { type TokenView } from '../../application/dto/token.view';

/** OAuth/OIDC token response (DESIGN §5). */
export class TokenResponse {
  @ApiProperty({ description: 'RS256-signed JWT access token.' })
  public accessToken!: string;

  @ApiProperty({ description: 'Opaque, single-use (rotating) refresh token.' })
  public refreshToken!: string;

  @ApiProperty({ enum: ['Bearer'], example: 'Bearer' })
  public tokenType!: string;

  @ApiProperty({ description: 'Access-token lifetime in seconds.', example: 900 })
  public expiresIn!: number;

  @ApiProperty({ format: 'uuid', description: 'User id (JWT sub).' })
  public sub!: string;

  @ApiProperty({ description: 'Active tenant context (JWT tid).' })
  public tid!: string;

  @ApiProperty({ description: 'Session id (JWT sid).' })
  public sid!: string;

  public static from(view: TokenView): TokenResponse {
    return Object.assign(new TokenResponse(), view);
  }
}

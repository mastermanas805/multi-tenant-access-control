import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/** HTTP request body for POST /v1/auth/refresh (OIDC refresh grant). */
export class RefreshTokenRequest {
  @ApiProperty({
    example: 'rt_x7Yk...redacted',
    description: 'The opaque refresh token returned by a prior grant.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  public refreshToken!: string;
}

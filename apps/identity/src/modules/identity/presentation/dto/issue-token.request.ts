import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * HTTP request body for POST /v1/auth/token (OIDC password grant). Transport-
 * level validation only; the domain re-validates the email shape.
 */
export class IssueTokenRequest {
  @ApiProperty({ example: 'riya@acme.com', format: 'email' })
  @IsEmail()
  @MaxLength(320)
  public email!: string;

  @ApiProperty({ example: 'Password123!', minLength: 1, maxLength: 256 })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  public password!: string;
}

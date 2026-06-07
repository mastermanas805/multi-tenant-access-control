import { ApiProperty } from '@nestjs/swagger';

import { type JwksView } from '../../application/dto/token.view';

/** A single RSA public JWK (RFC 7517). */
export class JwkResponse {
  @ApiProperty({ example: 'RSA' })
  public kty!: string;

  @ApiProperty({ example: 'sig' })
  public use!: string;

  @ApiProperty({ example: 'RS256' })
  public alg!: string;

  @ApiProperty({ description: 'Key id; matches the JWT header kid.' })
  public kid!: string;

  @ApiProperty({ description: 'RSA modulus (base64url).' })
  public n!: string;

  @ApiProperty({ description: 'RSA public exponent (base64url).' })
  public e!: string;
}

/** JSON Web Key Set published at /.well-known/jwks.json. */
export class JwksResponse {
  @ApiProperty({ type: [JwkResponse] })
  public keys!: JwkResponse[];

  public static from(view: JwksView): JwksResponse {
    const res = new JwksResponse();
    res.keys = view.keys.map((k) => Object.assign(new JwkResponse(), k));
    return res;
  }
}

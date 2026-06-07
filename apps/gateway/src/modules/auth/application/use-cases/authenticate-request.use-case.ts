import { Inject, Injectable } from '@nestjs/common';

import { type GatewayIdentity } from '../../domain/gateway-identity';
import { type TokenVerifier, TOKEN_VERIFIER } from '../../domain/token-verifier.port';
import { BearerToken } from '../../domain/value-objects/bearer-token.vo';
import { type AuthenticateRequestCommand } from '../dto/authenticate.commands';

/**
 * Authenticates an inbound request at the edge (DESIGN §4.3 step 1, §5):
 *   1. parse the `Authorization: Bearer` header (BearerToken VO),
 *   2. verify the JWT signature + claims against the Identity JWKS (port),
 *   3. project the verified claims into the trusted GatewayIdentity.
 *
 * Fail-closed (D8): the verifier throws on ANY problem and that propagates as a
 * 401. The derived identity carries IDENTITY + TENANT only — no roles (D4) — and
 * is the SOLE trusted source of who-the-caller-is; the proxy uses it to mint the
 * signed internal token, overwriting any client-sent identity headers (§7).
 */
@Injectable()
export class AuthenticateRequestUseCase {
  constructor(@Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier) {}

  public async execute(command: AuthenticateRequestCommand): Promise<GatewayIdentity> {
    const token = BearerToken.fromAuthorizationHeader(command.authorizationHeader);
    const claims = await this.verifier.verify(token);

    return {
      sub: claims.sub,
      tid: claims.tid,
      sessionId: claims.sid,
      // `act` marks the acting caller; a direct user login has act === sub (§7).
      actorId: claims.act ?? claims.sub,
      // The verified platform-admin scope (absent -> false, fail-closed). Carried
      // into the minted internal token so the PAP gates platform-wide surfaces on a
      // value it can verify, not a client-settable header (DESIGN §6/§7).
      platformAdmin: claims.platformAdmin === true,
    };
  }
}

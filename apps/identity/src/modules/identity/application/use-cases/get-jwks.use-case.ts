import { Inject, Injectable } from '@nestjs/common';

import { type TokenSigner, TOKEN_SIGNER } from '../../domain/token-signer.port';
import { type JwksView } from '../dto/token.view';

/**
 * Returns the public JSON Web Key Set for relying parties (the gateway/PEP) to
 * verify RS256 access-token signatures (DESIGN §5, §7). Publishing only the
 * PUBLIC key is what lets every downstream service verify a token without a
 * shared secret or a round-trip to the IdP.
 */
@Injectable()
export class GetJwksUseCase {
  constructor(@Inject(TOKEN_SIGNER) private readonly signer: TokenSigner) {}

  public execute(): JwksView {
    return this.signer.jwks();
  }
}

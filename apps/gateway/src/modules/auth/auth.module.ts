import { Global, Module } from '@nestjs/common';

import { AuthenticateRequestUseCase } from './application/use-cases/authenticate-request.use-case';
import { INTERNAL_TOKEN_MINTER } from './domain/internal-token-minter.port';
import { TOKEN_VERIFIER } from './domain/token-verifier.port';
import { HmacInternalTokenMinter } from './infrastructure/hmac-internal-token-minter';
import { JwksTokenVerifier } from './infrastructure/jwks-token-verifier';
import { JwtAuthGuard } from './presentation/jwt-auth.guard';

/**
 * Wires the edge authentication seam (DESIGN §4.3, §5, §7):
 *   - TOKEN_VERIFIER       -> JwksTokenVerifier (RS256 against Identity JWKS),
 *   - INTERNAL_TOKEN_MINTER-> HmacInternalTokenMinter (signed internal token),
 *   - AuthenticateRequestUseCase + JwtAuthGuard.
 *
 * Global + exporting the guard, the minter token and the use-case so the proxy
 * module (and any future authenticated surface) can attach the guard and mint the
 * forwarded identity without re-importing. Adapters are bound to ports here, so a
 * deployment can swap the verifier (e.g. an asymmetric internal-token verifier)
 * by providing a more specific binding.
 */
@Global()
@Module({
  providers: [
    AuthenticateRequestUseCase,
    JwtAuthGuard,
    { provide: TOKEN_VERIFIER, useClass: JwksTokenVerifier },
    { provide: INTERNAL_TOKEN_MINTER, useClass: HmacInternalTokenMinter },
  ],
  exports: [AuthenticateRequestUseCase, JwtAuthGuard, INTERNAL_TOKEN_MINTER],
})
export class AuthModule {}

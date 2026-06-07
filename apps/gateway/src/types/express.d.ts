import { type GatewayIdentity } from '../modules/auth/domain/gateway-identity';

/**
 * Ambient augmentation so the gateway can attach the per-request trace id and the
 * verified end-user identity onto Express's Request type-safely. `traceId` is set
 * by RequestContextMiddleware; `identity` is set by JwtAuthGuard ONLY after the
 * inbound user JWT has been cryptographically verified (DESIGN §4.3, §7). The
 * proxy layer reads `identity` to mint the signed internal token — it NEVER trusts
 * a client-sent identity header (confused-deputy defense, DESIGN §7).
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlation id (set by RequestContextMiddleware). */
      traceId?: string;
      /** The verified end-user identity (set by JwtAuthGuard after JWKS check). */
      identity?: GatewayIdentity;
    }
  }
}

export {};

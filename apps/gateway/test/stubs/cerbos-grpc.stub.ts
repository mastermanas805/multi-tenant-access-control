/**
 * Jest stub for the ESM-only `@cerbos/grpc` package.
 *
 * The gateway imports `@authz/pep` only for `IdentityContextMiddleware.TOKEN_HEADER`
 * (the `x-internal-identity` header name — single source of truth shared with the
 * downstream PEPs). The package barrel ALSO re-exports the `CerbosPdpClient`, which
 * `require`s `@cerbos/grpc` (an ESM module ts-jest's CommonJS transform cannot
 * load). The gateway never talks gRPC — so unit/e2e tests stub the gRPC client out.
 * moduleNameMapper points `@cerbos/grpc` here so transitively-loaded code resolves
 * without the real ESM.
 */
export class GRPC {}
export default { GRPC };

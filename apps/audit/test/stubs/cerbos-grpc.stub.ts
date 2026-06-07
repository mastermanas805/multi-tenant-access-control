/**
 * Jest stub for the ESM-only `@cerbos/grpc` package.
 *
 * The Audit service imports `@authz/pep` only for the IdentityContextMiddleware
 * (signed internal-token verification). The package barrel ALSO re-exports the
 * `CerbosPdpClient`, which `require`s `@cerbos/grpc` (an ESM module ts-jest's
 * CommonJS transform cannot load). The Audit service never talks gRPC to a PDP, so
 * unit/e2e tests stub the gRPC client out. moduleNameMapper points `@cerbos/grpc`
 * here so transitively-loaded code resolves without the real ESM. Mirrors the PAP.
 */
export class GRPC {}
export default { GRPC };

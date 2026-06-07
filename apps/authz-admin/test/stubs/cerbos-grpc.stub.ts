/**
 * Jest stub for the ESM-only `@cerbos/grpc` package.
 *
 * The PAP imports `@authz/pep` for `compilePolicyToCerbos` (a pure function). The
 * package barrel ALSO re-exports the `CerbosPdpClient`, which `require`s
 * `@cerbos/grpc` (an ESM module ts-jest's CommonJS transform cannot load). The PAP
 * never talks gRPC to the PDP — it publishes via the filesystem (watchForChanges) —
 * so unit/e2e tests stub the gRPC client out. moduleNameMapper points
 * `@cerbos/grpc` here so transitively-loaded code resolves without the real ESM.
 */
export class GRPC {}
export default { GRPC };

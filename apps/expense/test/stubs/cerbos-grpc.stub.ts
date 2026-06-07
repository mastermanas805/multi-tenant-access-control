/**
 * Jest stub for the ESM-only `@cerbos/grpc` package.
 *
 * The Expense PEP imports `@authz/pep`, whose barrel re-exports the
 * `CerbosPdpClient`, which `require`s `@cerbos/grpc` (an ESM module ts-jest's
 * CommonJS transform cannot load). Unit/e2e tests MOCK the PDP (they
 * `overrideProvider(CerbosPdpClient)` with a fake) and never open a real gRPC
 * channel, so the gRPC client is stubbed out. moduleNameMapper points
 * `@cerbos/grpc` here so transitively-loaded code resolves without the real ESM.
 */
export class GRPC {}
export default { GRPC };

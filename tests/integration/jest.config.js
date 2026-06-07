/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testRegex: '.*\\.int-spec\\.ts$',
  // Real Postgres + real Cerbos via Testcontainers: image pulls + container
  // start + three in-process Nest apps + a hot-reload settle window need a
  // generous ceiling. Each suite manages its own lifecycle in beforeAll/afterAll.
  testTimeout: 180_000,
  moduleNameMapper: {
    '^@kernel/core$': '<rootDir>/../../packages/kernel/src/index.ts',
    '^@kernel$': '<rootDir>/../../packages/kernel/src/index.ts',
    '^@kernel/(.*)$': '<rootDir>/../../packages/kernel/src/$1',
    '^@contracts/core$': '<rootDir>/../../packages/contracts/src/index.ts',
    '^@authz/pep$': '<rootDir>/../../packages/authz/src/index.ts',
    // NB: @cerbos/grpc is intentionally NOT stubbed here — the integration tests
    // talk to a REAL Cerbos container over gRPC (that is the whole point).
  },
  transform: {
    // ts-jest downlevels both our TS and the cerbos ESM JS to CJS so the real
    // @cerbos/grpc client loads under the node/CJS test runtime. The module-emit
    // override (commonjs) is applied here so the project's own tsconfig stays
    // `nodenext` for typecheck (which needs the @cerbos/grpc `exports` map).
    '^.+\\.(ts|js)$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.jest.json' }],
  },
  // The Cerbos client + its protobuf runtime + its uuid dep ship as pure ESM
  // ("type":"module"). jest ignores node_modules for transforms by default;
  // un-ignore the cerbos / bufbuild / uuid packages so they get downleveled to
  // CJS. pnpm nests them under .pnpm/<pkg>@ver/node_modules/<pkg>, so the negative
  // lookahead allows the optional .pnpm/<scope-or-pkg> prefix.
  transformIgnorePatterns: [
    '/node_modules/\\.pnpm/(?!(?:@cerbos|@bufbuild|uuid)[@+])',
  ],
};

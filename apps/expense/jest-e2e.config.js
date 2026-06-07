/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testRegex: '.*\\.e2e-spec\\.ts$',
  moduleNameMapper: {
    '^@kernel/core$': '<rootDir>/../../packages/kernel/src/index.ts',
    '^@kernel$': '<rootDir>/../../packages/kernel/src/index.ts',
    '^@kernel/(.*)$': '<rootDir>/../../packages/kernel/src/$1',
    '^@contracts/core$': '<rootDir>/../../packages/contracts/src/index.ts',
    '^@authz/pep$': '<rootDir>/../../packages/authz/src/index.ts',
    // The @authz/pep barrel transitively pulls @cerbos/grpc (ESM, unloadable by
    // ts-jest's CJS transform). Unit/e2e tests mock the PDP (CerbosPdpClient) and
    // never open a real gRPC channel, so stub the gRPC client out.
    '^@cerbos/grpc$': '<rootDir>/test/stubs/cerbos-grpc.stub.ts',
    '^@app/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
};

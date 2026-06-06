/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testRegex: '.*\\.spec\\.ts$',
  moduleNameMapper: {
    '^@kernel/core$': '<rootDir>/../../packages/kernel/src/index.ts',
    '^@kernel$': '<rootDir>/../../packages/kernel/src/index.ts',
    '^@kernel/(.*)$': '<rootDir>/../../packages/kernel/src/$1',
    '^@app/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
};

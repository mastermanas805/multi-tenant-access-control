/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  moduleNameMapper: {
    '^@kernel/core$': '<rootDir>/../../kernel/src/index.ts',
    '^@kernel$': '<rootDir>/../../kernel/src/index.ts',
    '^@kernel/(.*)$': '<rootDir>/../../kernel/src/$1',
    '^@contracts/core$': '<rootDir>/../../contracts/src/index.ts',
  },
};

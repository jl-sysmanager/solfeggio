/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { isolatedModules: true }] },
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  globalSetup: '<rootDir>/test/global-setup.ts',
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/worker.ts'],
  testTimeout: 30000,
  // Las suites e2e comparten la base de datos de test: se ejecutan en serie.
  maxWorkers: 1,
};

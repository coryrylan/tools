import { typescriptConfig, testsConfig, jsonConfig } from '@coryrylan/tools/eslint';

// Build tooling configs are type-checked by each project's `typecheck` script
// via its `tsconfig.node.json`; linting them is not worth a parser exception.
export default [
  ...typescriptConfig,
  ...testsConfig,
  ...jsonConfig,
  { ignores: ['**/vite.config.ts', '**/vitest.config.ts'] }
];

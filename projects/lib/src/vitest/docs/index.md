# vitest

Preset Vitest configs for node-environment unit tests and real-Chromium browser-mode component tests.

## Usage

### Node preset

For library/tooling unit tests: Node globals, no DOM.

```ts
// vitest.config.ts
import { mergeConfig, defineConfig } from 'vitest/config';
import { nodeTestConfig } from '@coryrylan/tools/vitest';

export default mergeConfig(
  nodeTestConfig,
  defineConfig({
    test: {
      // project-specific overrides
    },
  }),
);
```

### Browser preset

For component tests that need a real DOM: runs in an actual Chromium instance via the Playwright provider. Requires the optional peers `@vitest/browser-playwright`, `@vitest/coverage-istanbul`, and `playwright`, plus an installed browser binary:

```sh
pnpm exec playwright install chromium
```

```ts
// vitest.config.ts
import { mergeConfig, defineConfig } from 'vitest/config';
import { browserTestConfig } from '@coryrylan/tools/vitest/browser';

export default mergeConfig(
  browserTestConfig,
  defineConfig({
    test: {
      // project-specific overrides
    },
  }),
);
```

Import it from `@coryrylan/tools/vitest/browser`, not `@coryrylan/tools/vitest` - the browser preset lives in a separate entry point so the Playwright import never loads for consumers who only need the node preset.

## What it provides

- **Node preset** (`nodeTestConfig`): `environment: 'node'`, `globals: true`, `include: ['src/**/*.test.ts']`.
- **Browser preset** (`browserTestConfig`): a real Chromium instance via the `@vitest/browser-playwright` provider; headless except under `--watch`; `retry: 2` with worker/concurrency pinned to `1` in CI; Istanbul coverage gated at 90% lines/branches/functions/statements.

## Peer requirements

- Both presets require `vitest >=4.0.0`.
- The browser preset additionally requires `@vitest/browser-playwright >=4.0.0`, `@vitest/coverage-istanbul >=4.0.0`, and `playwright >=1.50.0`, all as optional peer dependencies - install them only in projects that use `@coryrylan/tools/vitest/browser`.

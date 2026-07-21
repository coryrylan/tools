import type { ViteUserConfig } from 'vitest/config';

/**
 * Preset Vitest config for node-environment unit tests of libraries and
 * tooling: Node globals, no DOM, `test.globals` enabled so specs can call
 * `describe`/`it`/`expect` without importing them.
 *
 * Extend it with `mergeConfig` rather than spreading manually, so array
 * fields (e.g. `test.include`) merge instead of getting clobbered:
 *
 * ```ts
 * // vitest.config.ts
 * import { mergeConfig, defineConfig } from 'vitest/config';
 * import { nodeTestConfig } from '@coryrylan/tools/vitest';
 *
 * export default mergeConfig(
 *   nodeTestConfig,
 *   defineConfig({
 *     test: { coverage: { provider: 'istanbul' } },
 *   }),
 * );
 * ```
 *
 * This module has zero runtime dependency on `@vitest/browser-playwright` -
 * it is safe to import without that optional peer installed. Browser-mode
 * config lives in the sibling `./browser.js` entry point instead, so a
 * plain node consumer never pulls in a Playwright import transitively.
 */
export const nodeTestConfig: ViteUserConfig = {
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
};

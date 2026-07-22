import type { ViteUserConfig } from 'vitest/config';

/**
 * Vitest config for node unit tests: Node globals, no DOM, `test.globals`
 * enabled. Extend with `mergeConfig` so array fields merge instead of
 * clobbering. No dependency on `@vitest/browser-playwright` - lives in
 * sibling `./browser.js` instead.
 *
 * @example
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
 */
export const nodeTestConfig: ViteUserConfig = {
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
};

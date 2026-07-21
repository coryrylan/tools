import process from 'node:process';
import type { ViteUserConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

// Read once at import time: neither the CI flag nor the CLI flags change
// mid-process, and re-reading them per test run would just be noise.
const isCi = process.env['CI'] !== undefined;
const isWatchMode = process.argv.includes('--watch');

// `exactOptionalPropertyTypes` treats an explicit `undefined` as distinct
// from an absent key, so the CI-only pin is built as a conditionally
// present object instead of `maxWorkers: isCi ? 1 : undefined`.
const ciConcurrencyLimits = isCi ? { maxWorkers: 1, maxConcurrency: 1 } : {};

/**
 * Preset Vitest config for browser-mode component tests against a real
 * Chromium instance via the Playwright provider. Separate entry point from
 * `./index.js` so a consumer without `@vitest/browser-playwright` installed
 * never loads this module's import of it.
 *
 * Extend it with `mergeConfig`:
 *
 * ```ts
 * // vitest.config.ts
 * import { mergeConfig, defineConfig } from 'vitest/config';
 * import { browserTestConfig } from '@coryrylan/tools/vitest/browser';
 *
 * export default mergeConfig(
 *   browserTestConfig,
 *   defineConfig({
 *     test: { setupFiles: ['./test-setup.ts'] },
 *   }),
 * );
 * ```
 *
 * Requires the optional peers `@vitest/browser-playwright`,
 * `@vitest/coverage-istanbul`, and `playwright`, plus a browser installed
 * via `pnpm exec playwright install chromium`.
 *
 * `CI`/`--watch` detection is resolved once at import time (see `isCi` and
 * `isWatchMode` above) - changing either after this module loads has no
 * effect on an already-built config.
 */
export const browserTestConfig: ViteUserConfig = {
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    retry: 2,
    // Caps workers/concurrency to avoid overloading the browser instance.
    ...ciConcurrencyLimits,
    testTimeout: 60000,
    hookTimeout: 30000,
    browser: {
      // Multiple parallel browser instances are expensive in CI; run files
      // serially there instead.
      fileParallelism: !isCi,
      enabled: true,
      provider: playwright({
        launchOptions: {
          // Generic Chromium CI-stability flags: containers/CI runners
          // commonly lack a full /dev/shm, a sandboxable uid, or GPU
          // acceleration, and the rest trim background work that just adds
          // flakiness/noise to a headless test run.
          args: [
            '--disable-dev-shm-usage',
            '--disable-setuid-sandbox',
            '--disable-software-rasterizer',
            '--no-sandbox',
            '--disable-gpu',
            '--disable-extensions',
            '--disable-background-networking',
            '--disable-default-apps',
            '--disable-sync',
            '--disable-translate',
            '--metrics-recording-only',
            '--mute-audio',
            '--no-first-run',
            '--safebrowsing-disable-auto-update',
            '--disable-features=TranslateUI',
            '--disable-features=BlinkGenPropertyTrees',
            '--disable-ipc-flooding-protection'
          ],
          timeout: 120000
        }
      }),
      headless: !isWatchMode,
      instances: [{ browser: 'chromium' }]
    },
    coverage: {
      provider: 'istanbul',
      reportsDirectory: './coverage/unit',
      reporter: [['lcov', { file: 'coverage.dat' }], 'html', 'json-summary'],
      thresholds: { lines: 90, branches: 90, functions: 90, statements: 90 },
      watermarks: {
        statements: [80, 90],
        functions: [80, 90],
        branches: [80, 90],
        lines: [80, 90]
      },
      include: ['src/**/*.ts'],
      exclude: ['**/dist/**', '**/*.test.ts', '**/*.d.ts', '**/*.examples.ts', 'vite.*.ts', 'vitest.*.ts']
    }
  }
};

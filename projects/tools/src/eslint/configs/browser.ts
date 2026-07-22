import type { Linter } from 'eslint';
import { plugin } from '../plugin.js';
import { globalIgnores, jsTsFiles } from './shared.js';

const ssrSafeMessage = (globalName: string): string =>
  `Use ${globalName} instead of the bare global so this code stays safe to run outside a full browser window (SSR, workers, tests).`;

/**
 * Flags direct references to browser globals assuming a `window`-backed
 * environment; `globalThis`-qualified works in browser, SSR, and worker
 * contexts alike. Also wires in `tools/*` listener/observer/timer cleanup
 * rules - DOM-lifecycle concerns too.
 */
export const browserConfig: Linter.Config[] = [
  globalIgnores,
  {
    files: jsTsFiles,
    plugins: { tools: plugin },
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'window', message: ssrSafeMessage('globalThis') },
        { name: 'location', message: ssrSafeMessage('globalThis.location') },
        { name: 'document', message: ssrSafeMessage('globalThis.document') }
      ],
      'tools/require-listener-cleanup': 'error',
      'tools/require-observer-cleanup': 'error',
      'tools/require-timer-cleanup': 'error'
    }
  }
];

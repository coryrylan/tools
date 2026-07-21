import type { ESLint, Linter } from 'eslint';
import { typescriptConfig } from './configs/typescript.js';
import { testsConfig } from './configs/tests.js';
import { htmlConfig } from './configs/html.js';
import { jsonConfig } from './configs/json.js';
import { browserConfig } from './configs/browser.js';
import { plugin } from './plugin.js';

export { typescriptConfig } from './configs/typescript.js';
export { testsConfig } from './configs/tests.js';
export { htmlConfig } from './configs/html.js';
export { jsonConfig } from './configs/json.js';
export { browserConfig } from './configs/browser.js';

/**
 * The `tools/*` rule registry every config below wires in under the
 * `tools` namespace (alongside `@typescript-eslint`/`jsdoc`/etc.). Defined
 * in `./plugin.js` - a separate module - so the configs can import the same
 * plugin instance directly without a circular import through this file.
 */
export { plugin };

interface ConfigsMap {
  readonly typescript: Linter.Config[];
  readonly tests: Linter.Config[];
  readonly html: Linter.Config[];
  readonly json: Linter.Config[];
  readonly browser: Linter.Config[];
}

interface AgentLintRules {
  readonly plugin: ESLint.Plugin;
  readonly configs: ConfigsMap;
}

const agentLintRules: AgentLintRules = {
  plugin,
  configs: {
    typescript: typescriptConfig,
    tests: testsConfig,
    html: htmlConfig,
    json: jsonConfig,
    browser: browserConfig
  }
};

export default agentLintRules;

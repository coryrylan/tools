import type { ESLint } from 'eslint';
import noDeadCode from './rules/no-dead-code.js';
import noDeepClassInheritance from './rules/no-deep-class-inheritance.js';
import noSingleConsumerAbstraction from './rules/no-single-consumer-abstraction.js';
import noUnjustifiedDisable from './rules/no-unjustified-disable.js';
import noReexportBarrels from './rules/no-reexport-barrels.js';
import consistentErrorMessages from './rules/consistent-error-messages.js';
import requireListenerCleanup from './rules/require-listener-cleanup.js';
import requireObserverCleanup from './rules/require-observer-cleanup.js';
import requireTimerCleanup from './rules/require-timer-cleanup.js';
import noUnpinnedDependencyRanges from './rules/no-unpinned-dependency-ranges.js';
import noExcessiveComments from './rules/no-excessive-comments.js';

/**
 * The `Record<string, RuleDefinition>` shape `ESLint.Plugin['rules']` expects.
 * `RuleDefinition` isn't re-exported from `eslint`, so it's recovered via
 * `ESLint.Plugin` instead of reaching into `@eslint/core`, without widening
 * to `any`.
 */
type PluginRules = NonNullable<ESLint.Plugin['rules']>;

const rules = {
  'no-dead-code': noDeadCode,
  'no-deep-class-inheritance': noDeepClassInheritance,
  'no-single-consumer-abstraction': noSingleConsumerAbstraction,
  'no-unjustified-disable': noUnjustifiedDisable,
  'no-reexport-barrels': noReexportBarrels,
  'consistent-error-messages': consistentErrorMessages,
  'require-listener-cleanup': requireListenerCleanup,
  'require-observer-cleanup': requireObserverCleanup,
  'require-timer-cleanup': requireTimerCleanup,
  'no-unpinned-dependency-ranges': noUnpinnedDependencyRanges,
  'no-excessive-comments': noExcessiveComments
} satisfies PluginRules;

/**
 * The `tools/*` rule registry shared by every config in `./configs/*.ts`.
 * Lives in its own module, not `index.ts`, so configs can import it directly
 * without a circular import back through `index.ts`.
 */
export const plugin: ESLint.Plugin = {
  meta: { name: '@coryrylan/tools', version: '0.1.0' },
  rules
};

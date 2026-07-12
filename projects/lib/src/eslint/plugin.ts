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

/**
 * The full `Record<string, RuleDefinition>` shape `ESLint.Plugin['rules']`
 * expects. `RuleDefinition` itself isn't re-exported from `eslint` (only
 * consumed internally to build `Rule.RuleModule`, `JSRuleDefinition`, and
 * `JSONRuleDefinition`), so it's recovered here via an indexed access on
 * `ESLint.Plugin` rather than reaching past `eslint` into the transitive
 * `@eslint/core` dependency. Every rule below is some instantiation of that
 * same generic `RuleDefinition<...>` - the ESTree rules through
 * `Rule.RuleModule`, `no-unpinned-dependency-ranges` through
 * `JSONRuleDefinition`
 * - so this one type is precise enough to cover all three without widening
 * to `any`/`unknown`.
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
  'no-unpinned-dependency-ranges': noUnpinnedDependencyRanges
} satisfies PluginRules;

/**
 * The `tools/*` rule registry, shared by every config in `./configs/*.ts`
 * under the `tools` namespace. Lives in its own module (rather than
 * `index.ts`, where it was previously declared empty) so the configs can
 * import it directly without a circular import back through `index.ts`.
 */
export const plugin: ESLint.Plugin = {
  meta: { name: '@coryrylan/tools', version: '0.1.0' },
  rules
};

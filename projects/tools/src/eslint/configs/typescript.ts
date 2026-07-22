import type { Linter } from 'eslint';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import jsdoc from 'eslint-plugin-jsdoc';
import { plugin } from '../plugin.js';
import { globalIgnores, jsTsFiles, tsFiles } from './shared.js';

/**
 * Flattens `strictTypeChecked`'s config array (base + eslint-recommended +
 * strict-type-checked) into a single rules record, the same way a project
 * would when folding it into one flat-config entry alongside custom rules.
 */
const strictTypeCheckedRules = tseslint.configs.strictTypeChecked.reduce<Linter.RulesRecord>(
  (rules, config) => ({ ...rules, ...config.rules }),
  {}
);

/**
 * Two entries: non-type-aware (all JS/TS, `@eslint/js` recommended plus
 * size/complexity limits) and type-aware (TS, `strictTypeChecked` plus
 * JSDoc), needing `projectService`, so slower. Default for agent projects;
 * relax per-project, don't swap out.
 */
export const typescriptConfig: Linter.Config[] = [
  globalIgnores,
  {
    files: jsTsFiles,
    plugins: { tools: plugin },
    rules: {
      ...js.configs.recommended.rules,
      complexity: ['error', { max: 8 }],
      'max-depth': ['error', 3],
      'max-params': ['error', 3],
      'max-lines': ['error', 500],
      'max-statements': ['error', 15],
      'max-lines-per-function': ['error', 50],
      'max-nested-callbacks': ['error', 3],
      'max-statements-per-line': ['error', { max: 1 }],
      eqeqeq: 'error',
      'prefer-const': 'error',
      'no-param-reassign': 'error',
      'no-useless-return': 'error',
      'no-useless-catch': 'error',
      'no-warning-comments': 'error',
      'no-shadow': 'error',
      'no-implicit-globals': 'error',
      'no-restricted-imports': ['error', { patterns: ['**/dist/**', '**/node_modules/**'] }],
      'id-length': ['error', { min: 2, exceptions: ['_'] }],
      'tools/no-dead-code': 'error',
      'tools/no-excessive-comments': 'error',
      'tools/no-single-consumer-abstraction': 'error',
      'tools/no-unjustified-disable': 'error',
      'tools/no-reexport-barrels': 'error',
      'tools/consistent-error-messages': 'error'
    }
  },
  {
    files: tsFiles,
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      jsdoc,
      tools: plugin
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true
      }
    },
    rules: {
      ...strictTypeCheckedRules,
      'tools/no-deep-class-inheritance': 'error',
      // strictTypeChecked doesn't cover scope shadowing; prefer the
      // type-aware variant over the core rule to avoid false positives on
      // overloads/declaration merging.
      'no-shadow': 'off',
      '@typescript-eslint/no-shadow': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/explicit-member-accessibility': ['error', { accessibility: 'no-public' }],
      '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'error',
      '@typescript-eslint/prefer-readonly': 'error',
      // Boundary-only variant of explicit return types: exported signatures
      // are pinned so the public API can't drift via inference, without
      // annotating every internal callback.
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      // Agent-written classes reach for `private` out of habit; `#private`
      // is enforced by the runtime (not just the type checker), so it stays
      // correct even if a rule elsewhere in the config is disabled.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            ':matches(PropertyDefinition, MethodDefinition)[accessibility="private"]:not(:has(Decorator)):not([kind="constructor"])',
          message:
            'Use #private instead of the `private` keyword - it is enforced at runtime, not just by the type checker.'
        }
      ],
      // Prevent redundant/conflicting type annotations between jsdoc and TypeScript.
      'jsdoc/no-types': 'error',
      'jsdoc/valid-types': 'error',
      'jsdoc/check-tag-names': 'error',
      'jsdoc/informative-docs': 'error'
    }
  }
];

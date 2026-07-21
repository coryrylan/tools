import type { Linter } from 'eslint';
import { globalIgnores } from './shared.js';

const files = ['**/*.test.*', '**/*.spec.*'];

/**
 * Relaxes size/complexity limits that make sense for source files but are
 * routinely and legitimately exceeded by thorough tests (long `describe`
 * blocks, many assertions, `expect(x).to.be.true` style unused-expression
 * patterns).
 */
export const testsConfig: Linter.Config[] = [
  globalIgnores,
  {
    files,
    rules: {
      'max-lines': 'off',
      'max-lines-per-function': 'off',
      'max-statements': 'off',
      'max-nested-callbacks': 'off',
      'no-unused-expressions': 'off',
      '@typescript-eslint/no-unused-expressions': 'off'
    }
  }
];

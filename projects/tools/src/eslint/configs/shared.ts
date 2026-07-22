import type { Linter } from 'eslint';

export const jsTsFiles = ['**/*.{js,ts}'];

export const tsFiles = ['**/*.ts'];

const ignoredPaths = ['**/node_modules/**', '**/dist/**', '**/build/**', '**/coverage/**', '**/.wireit/**'];

/**
 * A standalone `ignores`-only entry, first in each config array. ESLint
 * treats `ignores` as *global* only when no other keys share the object -
 * merging in `files`/`rules` scopes it to files instead.
 * https://github.com/eslint/eslint/discussions/18304
 */
export const globalIgnores: Linter.Config = { ignores: ignoredPaths };

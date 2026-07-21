import type { Linter } from 'eslint';

export const jsTsFiles = ['**/*.{js,ts}'];

export const tsFiles = ['**/*.ts'];

const ignoredPaths = ['**/node_modules/**', '**/dist/**', '**/build/**', '**/coverage/**', '**/.wireit/**'];

/**
 * A standalone `ignores`-only config entry, meant to be the first element of
 * every exported config array. ESLint only treats an `ignores` entry as a
 * *global* ignore when no other keys (`files`, `rules`, ...) share the same
 * object - merging them in turns it into a file-scoped ignore instead of a
 * global one. https://github.com/eslint/eslint/discussions/18304
 */
export const globalIgnores: Linter.Config = { ignores: ignoredPaths };

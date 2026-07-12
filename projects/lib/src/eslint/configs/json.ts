import type { Linter } from 'eslint';
import json from '@eslint/json';
import { plugin } from '../plugin.js';
import { globalIgnores } from './shared.js';

/**
 * Structural correctness for JSON files (duplicate keys, unsafe numeric
 * values, ...) - the same class of "syntactically valid but semantically
 * broken" failure the JS/TS configs guard against, just for manifests and
 * config files. `tsconfig*.json` gets the JSONC variant since it commonly
 * carries comments.
 *
 * `package.json` additionally gets the `tools/no-unpinned-dependency-ranges`
 * check, scoped separately since it only applies to that one filename, not
 * JSON generally.
 */
export const jsonConfig: Linter.Config[] = [
  globalIgnores,
  {
    files: ['**/*.json'],
    ignores: ['**/tsconfig*.json', '**/tsconfig.*.json'],
    language: 'json/json',
    plugins: { json },
    rules: {
      ...json.configs.recommended.rules
    }
  },
  {
    files: ['**/tsconfig*.json', '**/tsconfig.*.json'],
    language: 'json/jsonc',
    plugins: { json },
    rules: {
      ...json.configs.recommended.rules
    }
  },
  {
    files: ['**/package.json'],
    language: 'json/json',
    plugins: { tools: plugin },
    rules: {
      'tools/no-unpinned-dependency-ranges': 'error'
    }
  }
];

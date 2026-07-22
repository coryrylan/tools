import type { Linter } from 'eslint';
import json from '@eslint/json';
import { plugin } from '../plugin.js';
import { globalIgnores } from './shared.js';

/**
 * Structural correctness for JSON (duplicate keys, unsafe numbers), same
 * class of failure the JS/TS configs guard against. `tsconfig*.json` gets
 * the JSONC variant for comment support. `package.json` also gets
 * `no-unpinned-dependency-ranges`.
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

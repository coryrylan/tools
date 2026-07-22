import type { Linter } from 'eslint';
import html from '@html-eslint/eslint-plugin';
import htmlParser from '@html-eslint/parser';
import { globalIgnores } from './shared.js';

/**
 * Structural and correctness rules for HTML: `@html-eslint` recommended
 * (duplicate ids/attrs, obsolete tags, `lang`/`alt`) with formatting rules
 * off - Prettier owns those. `frontmatter: true` lets 11ty-style templates
 * carry YAML frontmatter.
 */
export const htmlConfig: Linter.Config[] = [
  globalIgnores,
  {
    files: ['**/*.html'],
    languageOptions: {
      parser: htmlParser,
      parserOptions: {
        frontmatter: true
      }
    },
    plugins: { html },
    rules: {
      ...html.configs.recommended.rules,
      'html/require-doctype': 'off',
      'html/require-title': 'off',
      'html/no-extra-spacing-text': 'error',
      'html/quotes': 'off', // prettier
      'html/no-extra-spacing-attrs': 'off', // prettier
      'html/indent': 'off', // prettier
      'html/require-closing-tags': 'off', // prettier
      'html/element-newline': 'off', // prettier
      'html/no-extra-spacing-tags': 'off', // prettier
      'html/attrs-newline': [
        'error',
        {
          closeStyle: 'sameline',
          ifAttrsMoreThan: 10
        }
      ]
    }
  }
];

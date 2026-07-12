import type { Linter } from 'eslint';
import html from '@html-eslint/eslint-plugin';
import htmlParser from '@html-eslint/parser';
import { globalIgnores } from './shared.js';

/**
 * Structural and correctness rules for HTML files: `@html-eslint`
 * recommended (duplicate ids/attrs, obsolete tags, `lang`/`alt`
 * requirements, baseline feature checks, ...) with the pure-formatting
 * rules turned off - Prettier owns formatting. `frontmatter: true` lets
 * static-site templates (11ty and similar) carry YAML frontmatter without
 * tripping the parser.
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

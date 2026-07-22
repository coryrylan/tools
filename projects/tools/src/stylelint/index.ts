import type { Config } from 'stylelint';

/**
 * Personal Stylelint preferences layered on `stylelint-config-standard`.
 * Point `stylelint.config.js` at it with
 * `export { default } from '@coryrylan/tools/stylelint';`, or add
 * `rules`/`overrides` on the default export for project overrides.
 */
const config: Config = {
  extends: ['stylelint-config-standard'],
  ignoreFiles: ['**/node_modules/**', '**/dist/**', '**/.wireit/**', '**/.eslintcache/**', '**/coverage/**'],
  rules: {
    'alpha-value-notation': 'number',
    'hue-degree-notation': 'number',
    'property-no-vendor-prefix': null,
    // Formatting concern owned by Prettier, not Stylelint.
    'declaration-empty-line-before': null,
    'custom-property-empty-line-before': null,
    // Vite's CSS import graph mixes string and url() `@import` notations; enforcing one is impractical.
    'import-notation': null,
    'custom-property-pattern': '^_?[a-z][a-z0-9]*(-[a-z0-9]+)*$',
    'value-keyword-case': ['lower', { ignoreKeywords: ['currentColor'] }],
    // Grid layouts read better as the longhand `grid-template-*` properties.
    'declaration-block-no-redundant-longhand-properties': [true, { ignoreShorthands: ['grid-template'] }],
    // Selectors are deliberately repeated across sections for readability.
    'no-duplicate-selectors': null,
    'no-descending-specificity': null,
    'comment-empty-line-before': null,
    'property-disallowed-list': [
      // Logical properties are required for internationalization.
      'margin-left',
      'margin-right',
      'margin-top',
      'margin-bottom',
      'padding-left',
      'padding-right',
      'padding-top',
      'padding-bottom'
    ],
    'declaration-property-value-disallowed-list': [
      {
        '/^(margin|padding)(-(top|right|bottom|left|inline|block|inline-start|inline-end|block-start|block-end))?$/': [
          '/(?<!\\w)\\d+px/'
        ],
        '/^(gap|row-gap|column-gap)$/': ['/(?<!\\w)\\d+px/'],
        '/^(top|right|bottom|left)$/': ['/(?<!\\w)\\d+px/'],
        '/^inset(-(inline|block)(-(start|end))?)?$/': ['/(?<!\\w)\\d+px/']
      },
      { message: 'Use a CSS custom property (design token) instead of a hardcoded pixel value.' }
    ]
  }
};

export default config;

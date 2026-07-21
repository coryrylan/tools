import type { Config } from 'prettier';

/**
 * Personal Prettier preferences, shared across projects so formatting stops
 * being a per-repo decision. Point `package.json`'s `"prettier"` field at
 * `"@coryrylan/tools/prettier"` to consume it directly, or import this
 * default export and spread it into a local `prettier.config.js` to layer
 * project-specific overrides on top.
 *
 * `embeddedLanguageFormatting: 'off'` is deliberate: embedded template
 * literals (Lit `html`/`css` tagged templates) are hand-formatted rather
 * than reflowed by Prettier's embedded-language support, which tends to
 * mangle multi-line markup readability.
 */
const config: Config = {
  trailingComma: 'none',
  tabWidth: 2,
  printWidth: 120,
  semi: true,
  singleQuote: true,
  arrowParens: 'avoid',
  bracketSameLine: true,
  embeddedLanguageFormatting: 'off',
  singleAttributePerLine: false
};

export default config;

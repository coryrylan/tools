import type { Config } from 'prettier';

/**
 * Shared Prettier preferences so formatting isn't per-repo. Point
 * `package.json`'s `"prettier"` at `"@coryrylan/tools/prettier"`, or
 * spread it locally.
 *
 * `embeddedLanguageFormatting: 'off'`: Lit templates are hand-formatted,
 * not Prettier reflowed.
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

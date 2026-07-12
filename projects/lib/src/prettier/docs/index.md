# prettier

Opinionated Prettier defaults shared across every project instead of re-decided per repo.

## Usage

```sh
pnpm add -D @coryrylan/tools prettier
```

Point `package.json`'s `"prettier"` field at the package's deep-import path:

```json
{
  "prettier": "@coryrylan/tools/prettier"
}
```

For project-specific overrides, import the default export and spread it into a `prettier.config.js` instead:

```js
// prettier.config.js
import config from '@coryrylan/tools/prettier';

/** @type {import("prettier").Config} */
export default { ...config, printWidth: 100 };
```

## Preferences

| Option                       | Value     | Why                                                                                                                                                                   |
| ---------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trailingComma`              | `'none'`  | No dangling commas on the last item of a multiline list.                                                                                                              |
| `tabWidth`                   | `2`       | Two-space indentation.                                                                                                                                                |
| `printWidth`                 | `120`     | Modern displays comfortably fit wider lines than the 80-column default; fewer forced wraps.                                                                           |
| `semi`                       | `true`    | Explicit statement terminators - no ASI ambiguity.                                                                                                                    |
| `singleQuote`                | `true`    | Single quotes for strings, consistent with most JS style guides.                                                                                                      |
| `arrowParens`                | `'avoid'` | Drop parens around a single arrow-function parameter (`x => x`, not `(x) => x`).                                                                                      |
| `bracketSameLine`            | `true`    | A JSX/HTML tag's closing `>` stays on the last attribute's line instead of dropping to its own.                                                                       |
| `embeddedLanguageFormatting` | `'off'`   | Embedded template literals (Lit `html`/`css` tagged templates) are hand-formatted; Prettier's embedded-language reflow tends to mangle multi-line markup readability. |
| `singleAttributePerLine`     | `false`   | A single attribute doesn't force a tag onto its own multiline block.                                                                                                  |

## Peer requirements

- `prettier >=3`, installed by the consumer as an optional peer dependency.

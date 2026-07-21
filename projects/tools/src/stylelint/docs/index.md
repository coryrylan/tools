# stylelint

Shared Stylelint config layered on `stylelint-config-standard`, encoding logical properties and design-token usage as lint errors instead of review comments.

## Usage

```sh
pnpm add -D @coryrylan/tools stylelint stylelint-config-standard
```

Re-export the default config from a `stylelint.config.js`:

```js
// stylelint.config.js
export { default } from '@coryrylan/tools/stylelint';
```

For project-specific overrides, import the default export and extend it:

```js
// stylelint.config.js
import config from '@coryrylan/tools/stylelint';

/** @type {import("stylelint").Config} */
export default {
  ...config,
  rules: {
    ...config.rules,
    'selector-class-pattern': null,
  },
};
```

## What it enforces

| Rule                                                                                                                                                                                                     | What it catches                                                                                | Rationale                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `property-disallowed-list`                                                                                                                                                                               | Physical `margin-*`/`padding-*` longhands (`margin-left`, `padding-top`, ...)                  | Logical properties (`margin-inline-start`, `padding-block-start`, ...) are required for internationalization - physical properties don't flip under RTL.                                                                                        |
| `declaration-property-value-disallowed-list`                                                                                                                                                             | Hardcoded `px` values on margin/padding/gap/inset properties                                   | Use a CSS custom property (design token) instead of a hardcoded pixel value.                                                                                                                                                                    |
| `custom-property-pattern`                                                                                                                                                                                | Custom property names outside `--kebab-case` (with an optional leading `_` for private tokens) | One naming convention for every custom property.                                                                                                                                                                                                |
| `value-keyword-case`                                                                                                                                                                                     | Non-lowercase value keywords, except `currentColor`                                            | `currentColor`'s casing is spec-mandated; everything else stays lowercase.                                                                                                                                                                      |
| `declaration-block-no-redundant-longhand-properties`                                                                                                                                                     | Redundant longhands, except `grid-template-*`                                                  | Grid layouts read better as the longhand `grid-template-*` properties than collapsed into the `grid-template` shorthand.                                                                                                                        |
| `alpha-value-notation` / `hue-degree-notation`                                                                                                                                                           | Percentage alpha/hue notation                                                                  | Numbers only, for consistency across color functions.                                                                                                                                                                                           |
| `property-no-vendor-prefix`, `declaration-empty-line-before`, `custom-property-empty-line-before`, `import-notation`, `no-duplicate-selectors`, `no-descending-specificity`, `comment-empty-line-before` | -                                                                                              | Turned off: vendor prefixes are a deliberate style choice, blank-line placement is Prettier's job, `@import` notation varies with Vite's CSS import graph, and selector repetition/ordering/comment spacing are readability calls, not defects. |

## Peer requirements

- `stylelint >=17`, installed by the consumer as an optional peer dependency.
- `stylelint-config-standard >=40`, installed by the consumer as an optional peer dependency.

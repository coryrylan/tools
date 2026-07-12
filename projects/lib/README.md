# @coryrylan/tools

Shared tooling configs - ESLint, Prettier, Stylelint, Vale, Vite, and
Vitest - plus custom ESLint rules for keeping codebases maintainable when
coding agents are the primary contributors.

## Philosophy

When an agent is the one writing most of a diff, prose instructions living in
an `AGENTS.md` file are advisory at best. They have to be loaded into
context, correctly interpreted, and remembered turns later, and none of that
is guaranteed on any given run. Prose decays: it drifts out of context, gets
skimmed instead of read, or is outweighed by whatever the agent is focused on
in the moment. A lint rule has none of these failure modes: it runs on every
diff, every time, and fails the build instead of hoping to be noticed. Every
rule and every shared config in this package exists to replace a paragraph an
agent would otherwise have to read (and might ignore, forget, or misapply)
with a deterministic check or preset that gates the diff instead.

## Surfaces

| Entry                                            | What it ships                                                                    |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| `@coryrylan/tools/eslint`                        | Flat configs plus the custom `tools/*` rule plugin.                              |
| `@coryrylan/tools/prettier`                      | The shared Prettier config.                                                      |
| `@coryrylan/tools/stylelint`                     | Shared Stylelint config (standard + logical properties + design-token checks).   |
| `@coryrylan/tools/vite`                          | `createNodeLibraryBuildConfig` / `createBrowserLibraryBuildConfig` factories.    |
| `@coryrylan/tools/vite/plugins/write-if-changed` | Vite plugin that skips writing chunks whose content didn't change.               |
| `@coryrylan/tools/vite/plugins/dts`              | Vite plugin that runs the consumer's TypeScript compiler for declaration output. |
| `@coryrylan/tools/vitest`                        | `nodeTestConfig` preset for node-environment unit tests.                         |
| `@coryrylan/tools/vitest/browser`                | `browserTestConfig` preset for browser-mode (Playwright Chromium) tests.         |
| `dist/vale/`                                     | Vale starter kit: ini template plus shared accept/reject vocabulary.             |

## ESLint

```sh
pnpm add -D eslint @coryrylan/tools typescript typescript-eslint
```

The remaining peers (`@eslint/js`, `@eslint/json`, `eslint-plugin-jsdoc`)
install automatically as regular peer dependencies under pnpm 10 or npm.
Yarn users should add them to `devDependencies` explicitly.

```js
// eslint.config.js
import { typescriptConfig, jsonConfig } from '@coryrylan/tools/eslint';

export default [...typescriptConfig, ...jsonConfig];
```

A default export is also available if you'd rather reach into the plugin and
config map directly: `import agentLintRules from '@coryrylan/tools/eslint'`
exposes `{ plugin, configs }`, where `configs` is keyed by `typescript`, `tests`, `browser`, `html`, and `json`.

### Configs

| Config             | What it enables                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Requirements                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `typescriptConfig` | On all JS/TS files: size/complexity budgets (`complexity` 8, `max-depth` 3, `max-params` 3, `max-lines` 500, `max-statements` 15, `max-lines-per-function` 50, `max-nested-callbacks` 3) plus `eqeqeq`, `prefer-const`, `no-shadow`, `no-warning-comments`, `no-param-reassign`, and friends, and 5 syntax-only `tools/*` rules. On TS files: type-aware `strictTypeChecked`, plus `@typescript-eslint/no-floating-promises`, `only-throw-error`, `consistent-type-imports`, `switch-exhaustiveness-check`, `explicit-member-accessibility` (`no-public`), a `#private`-over-`private` selector, `no-explicit-any`, `no-unnecessary-boolean-literal-compare`, `jsdoc` checks (`informative-docs`, `no-types`, `valid-types`, `check-tag-names`), and the type-aware `tools/no-deep-class-inheritance` rule. The default starting point for a new agent-maintained project - relax specific rules per-project rather than swapping this config out. | `typescript-eslint`, `eslint-plugin-jsdoc`, `typescript >=5.5.0 <6.1.0`, `parserOptions.projectService` |
| `testsConfig`      | Relaxes size/complexity budgets (`max-lines`, `max-lines-per-function`, `max-statements`, `max-nested-callbacks`, unused-expression checks) for `*.test.*` / `*.spec.*` files.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | combine with another config                                                                             |
| `browserConfig`    | `globalThis`-over-`window`/`document`/`location` restrictions, plus 3 cleanup rules (`require-listener-cleanup`, `require-observer-cleanup`, `require-timer-cleanup`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | none extra                                                                                              |
| `htmlConfig`       | `@html-eslint` recommended structural rules for `*.html` files (duplicate ids/attrs, obsolete tags, `lang`/`alt` requirements, baseline feature checks), with pure-formatting rules off in favor of Prettier and frontmatter-aware parsing for static-site templates.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `@html-eslint/eslint-plugin`, `@html-eslint/parser`                                                     |
| `jsonConfig`       | `@eslint/json` structural rules for `*.json` (JSONC variant for `tsconfig*.json`), plus `no-unpinned-dependency-ranges` scoped to `package.json`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `@eslint/json`                                                                                          |

### Rules

| Rule                                                                                                | What it catches                                                                                                                                        | Enabled by   |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| [`tools/no-dead-code`](./src/eslint/docs/rules/no-dead-code.md)                                     | Disallow commented-out source code left behind in comments.                                                                                            | `typescript` |
| [`tools/no-deep-class-inheritance`](./src/eslint/docs/rules/no-deep-class-inheritance.md)           | Disallow class inheritance chains deeper than a configured maximum.                                                                                    | `typescript` |
| [`tools/no-single-consumer-abstraction`](./src/eslint/docs/rules/no-single-consumer-abstraction.md) | Disallow exported abstractions (base classes) with fewer than two implementation consumers.                                                            | `typescript` |
| [`tools/no-unjustified-disable`](./src/eslint/docs/rules/no-unjustified-disable.md)                 | Require every `eslint-disable*` directive to carry a reason (and, by default, an explicit rule list).                                                  | `typescript` |
| [`tools/no-reexport-barrels`](./src/eslint/docs/rules/no-reexport-barrels.md)                       | Flag files that re-export from more than a configured number of modules.                                                                               | `typescript` |
| [`tools/consistent-error-messages`](./src/eslint/docs/rules/consistent-error-messages.md)           | Require thrown/constructed `Error`s to carry a non-empty, informative message.                                                                         | `typescript` |
| [`tools/require-listener-cleanup`](./src/eslint/docs/rules/require-listener-cleanup.md)             | Require a matching `removeEventListener` for every `addEventListener` added in a setup lifecycle method; forbid `addEventListener` in the constructor. | `browser`    |
| [`tools/require-observer-cleanup`](./src/eslint/docs/rules/require-observer-cleanup.md)             | Flag `ResizeObserver`/`MutationObserver`/`IntersectionObserver`/`PerformanceObserver` instances created without storing a reference.                   | `browser`    |
| [`tools/require-timer-cleanup`](./src/eslint/docs/rules/require-timer-cleanup.md)                   | Flag `setInterval` handles that are never stored or never cleared.                                                                                     | `browser`    |
| [`tools/no-unpinned-dependency-ranges`](./src/eslint/docs/rules/no-unpinned-dependency-ranges.md)   | Require `package.json` dependency version specifiers appropriate to the package's publish status and dependency kind.                                  | `json`       |

## Prettier

```sh
pnpm add -D @coryrylan/tools prettier
```

Reference the config straight from `package.json`:

```json
{ "prettier": "@coryrylan/tools/prettier" }
```

Or import and spread it in a `prettier.config.js` to override options.
Embedded template literals stay hand-formatted
(`embeddedLanguageFormatting: 'off'`). See
[src/prettier/docs](./src/prettier/docs/index.md).

## Stylelint

```sh
pnpm add -D @coryrylan/tools stylelint stylelint-config-standard
```

```js
// stylelint.config.js
export { default } from '@coryrylan/tools/stylelint';
```

Layers `stylelint-config-standard` with logical-property enforcement (no
physical `margin-*`/`padding-*`) and design-token checks (no hardcoded pixel
values in spacing properties). See
[src/stylelint/docs](./src/stylelint/docs/index.md).

## Vale

Install the Vale binary (`mise use vale`, or brew), then point a `.vale.ini`
at the styles this package ships:

```ini
StylesPath = node_modules/@coryrylan/tools/dist/vale/styles
Vocab = Tools
Packages = Google, write-good
```

Run `vale sync` once to download the style packages. The full template with
per-filetype sections lives at [src/vale/vale.ini](./src/vale/vale.ini). See
[src/vale/docs](./src/vale/docs/index.md).

## Vite

```sh
pnpm add -D @coryrylan/tools vite
```

```ts
// vite.config.ts
import { defineConfig, mergeConfig } from 'vite';
import { createNodeLibraryBuildConfig } from '@coryrylan/tools/vite';

export default defineConfig(mergeConfig(createNodeLibraryBuildConfig({ entry: { index: 'src/index.ts' } }), {}));
```

ESM-only, every bare specifier externalized, `preserveModules` for deep
imports, no minification. The `write-if-changed` and `dts` plugins ship as
deep imports under `@coryrylan/tools/vite/plugins/`. See
[src/vite/docs](./src/vite/docs/index.md).

## Vitest

```sh
pnpm add -D @coryrylan/tools vitest
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import { nodeTestConfig } from '@coryrylan/tools/vitest';

export default defineConfig(nodeTestConfig);
```

`@coryrylan/tools/vitest/browser` exports `browserTestConfig` for real-Chromium
browser-mode tests (requires the optional `@vitest/browser-playwright`,
`@vitest/coverage-istanbul`, and `playwright` peers) with istanbul coverage
gated at 90% across lines, branches, functions, and statements. See
[src/vitest/docs](./src/vitest/docs/index.md).

## Peer dependencies

Every peer beyond `eslint` is scoped to the surface that needs it; the
non-ESLint peers are marked optional, so install them with the surface you
use.

- `typescript` must satisfy `>=5.5.0 <6.1.0` for type-aware linting
  (`typescriptConfig`) - this is the range `typescript-eslint`
  supports; newer `typescript` majors are not yet compatible with type-aware
  rules here. Note that a bare `pnpm add -D typescript` resolves to 7.x
  (the native compiler, which no longer ships the JS compiler API
  `typescript-eslint` needs), so install an explicit `typescript@6` until
  `typescript-eslint` supports 7.
- `typescript-eslint >=8.40.0` and `eslint-plugin-jsdoc >=60.0.0` are only
  needed if you use `typescriptConfig`.
- `@eslint/json >=0.13.0` is only needed if you use `jsonConfig`.
- `@html-eslint/eslint-plugin >=0.61.0` and `@html-eslint/parser >=0.61.0` are
  only needed if you use `htmlConfig`.
- `prettier >=3` for the Prettier config; `stylelint >=17` and
  `stylelint-config-standard >=40` for the Stylelint config.
- `vite >=8` for the Vite factories and plugins; `vitest >=4` for the test
  presets, plus `@vitest/browser-playwright >=4`, `@vitest/coverage-istanbul >=4`,
  and `playwright >=1.50` for `browserTestConfig`.

## License

MIT - see [LICENSE](./LICENSE). Copyright (c) 2026 Cory Rylan.

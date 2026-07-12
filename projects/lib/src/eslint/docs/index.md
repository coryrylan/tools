# eslint

Flat ESLint configs plus custom `tools/*` rules that replace prose agent instructions with deterministic lint gates.

## Usage

```sh
pnpm add -D eslint @coryrylan/tools typescript typescript-eslint
```

```js
// eslint.config.js
import { typescriptConfig, testsConfig, jsonConfig } from '@coryrylan/tools/eslint';

export default [...typescriptConfig, ...testsConfig, ...jsonConfig];
```

Start from `typescriptConfig` and relax specific rules per project rather than swapping the config out.

## Configs

| Config             | What it enables                                                                                                                                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typescriptConfig` | Core size/complexity budgets, correctness rules, and the syntax-only `tools/*` rules on all JS/TS files, plus type-aware `strictTypeChecked`, JSDoc checks, and the type-aware `tools/*` rules on TS files. The default starting point. |
| `testsConfig`      | Relaxed size/complexity budgets for `*.test.*` / `*.spec.*` files.                                                                                                                                                                      |
| `browserConfig`    | `globalThis` restrictions plus the listener/observer/timer cleanup rules.                                                                                                                                                               |
| `htmlConfig`       | `@html-eslint` recommended structural rules for HTML files, formatting deferred to Prettier, frontmatter-aware.                                                                                                                         |
| `jsonConfig`       | `@eslint/json` structural rules plus `tools/no-unpinned-dependency-ranges` for `package.json`.                                                                                                                                          |

<!-- agents-rules-catalog -->

## Peer requirements

`eslint >=9` always; `typescript >=5.5 <6.1` and `typescript-eslint >=8.40` for the type-aware configs; `@eslint/json >=0.13` for `jsonConfig`; `@html-eslint/eslint-plugin >=0.61` and `@html-eslint/parser >=0.61` for `htmlConfig`; `eslint-plugin-jsdoc >=60` for `typescriptConfig`.

---
{
  title: '@coryrylan/tools',
  description: 'An opinionated, strictness-first collection of tooling configs - linting, formatting, CSS, prose, builds, and tests - for codebases where coding agents are the primary contributors.',
  layout: 'index.11ty.js',
}
---

# Tools

An opinionated, strictness-first collection of tooling configs - linting, formatting, CSS, prose, builds, and tests - for codebases where coding agents are the primary contributors.

## Philosophy

Prose instructions in an `AGENTS.md` file are advisory: an agent has to load them into context, interpret them correctly, and still remember them turns later. An automated gate has none of those failure modes - it runs on every diff and fails the build instead of hoping to be noticed. Every surface here replaces a paragraph an agent might skim past with a deterministic check: formatting is settled by Prettier, CSS conventions and docs prose are lint rules (Stylelint, Vale), tests carry coverage gates (Vitest), builds come from strict factories (Vite), and ESLint goes deepest - type-aware `strictTypeChecked` plus `tools/*` rules for agent-specific failure modes like dead code and unjustified disables.

The defaults are personal and deliberately strict. Relax specific rules per project - a loosened rule in your config is a visible decision, while a lax default is invisible everywhere.

## What it ships

| Surface                   | What you get                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| [ESLint](eslint/)         | Flat configs plus the full catalog of custom `tools/*` rules.                                   |
| [Pi](pi/)                 | Extensions for the pi coding agent - spoken greetings, audio turn summaries, and project hooks.  |
| [Prettier](prettier/)     | One shared formatting config, referenced straight from `package.json`.                           |
| [Stylelint](stylelint/)   | Standard config plus logical-property and design-token enforcement.                              |
| [Vale](vale/)             | Prose-lint starter kit: ini template plus a shared accept/reject vocabulary.                     |
| [Vite](vite/)             | Library build config factories plus the `write-if-changed` and `dts` plugins.                    |
| [Vitest](vitest/)         | Node and browser-mode (playwright) test presets with coverage gates.                             |

## Quickstart

Install the package and the tools you plan to use:

```sh
pnpm add -D @coryrylan/tools eslint typescript typescript-eslint prettier stylelint
```

Wire up ESLint, Prettier, and Stylelint:

```js
// eslint.config.js
import { typescriptConfig, jsonConfig } from '@coryrylan/tools/eslint';

export default [...typescriptConfig, ...jsonConfig];
```

```json
{
  "prettier": "@coryrylan/tools/prettier"
}
```

```js
// stylelint.config.js
export { default } from '@coryrylan/tools/stylelint';
```

Builds and tests wire up the same way - the [Vite](vite/) library build factories and the [Vitest](vitest/) node/browser presets are each a one-import config. Each surface's page covers its own install, usage, and peer requirements. The [package README](https://github.com/coryrylan/tools/blob/main/projects/tools/README.md) has the full peer-dependency and licensing details.

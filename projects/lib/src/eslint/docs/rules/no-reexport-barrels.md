# tools/no-reexport-barrels

Flag files that re-export from more than a configured number of modules.

## Why this matters for agents

Agents follow imports file-to-file to find a symbol's definition. A deep barrel (`export * from './x.js'` repeated across many modules) means "find `thing`" turns into "load the barrel, then load every module it touches" - the entire dependency closure lands in context for what should have been a one-file lookup. Barrels also block bundlers from tree-shaking unused exports and are a frequent source of import cycles once enough modules re-export each other.

## Examples

❌ Incorrect (default `maxReexports: 5`):

```js
// index.ts
export * from './button.js';
export * from './input.js';
export * from './modal.js';
export * from './tooltip.js';
export * from './toast.js';
export * from './card.js';
```

✅ Correct:

```js
// consumers import the concrete module directly
import { Button } from './components/button.js';
import { Modal } from './components/modal.js';
```

## Options

```ts
interface Options {
  /** Modules a single file may re-export from before this rule reports. */
  maxReexports?: number; // default: 5, minimum: 0

  /**
   * When true (the default), `export { a } from './x.js'` (a named
   * re-export with a source) does not count toward the limit - only
   * `export * from './x.js'` / `export * as ns from './x.js'` do. Set to
   * false to count named re-exports too.
   */
  allowNamed?: boolean; // default: true
}
```

## When not to use it

Skip this rule for files whose entire purpose is a public API barrel (e.g. a package's single `index.ts` entry point re-exporting its full surface) where the re-export count is expected to be large and reviewed deliberately, or in codebases without tree-shaking-sensitive bundling where the context-bloat trade-off doesn't apply.

# tools/no-dead-code

Disallow commented-out source code left behind in comments.

## Why this matters for agents

When an agent isn't sure a change is safe, the easy move is to comment out the old implementation "just in case" instead of deleting it - version control already remembers it, but that isn't where the agent is looking. Every one of those zombie snippets stays in the file forever, and the next agent (or the same one, later) reads it as if it might still be relevant: it gets copied into new code, cited as evidence for how something "really" works, or simply burns context budget being parsed and reasoned about for no benefit. Deleting dead code and trusting git history keeps every comment a reader encounters meaningful.

## Examples

❌ Incorrect:

```js
// function computeTotal(items) {
//   return items.reduce((sum, item) => sum + item.price, 0);
// }
function computeTotal(items) {
  return items.reduce((sum, item) => sum + item.price, 0) * TAX_RATE;
}

/*
import { legacyFormatter } from './legacy-formatter.js';
const formatted = legacyFormatter(value);
*/
const formatted = format(value);
```

✅ Correct:

```js
// Includes tax; see CHANGELOG for the pre-tax version this replaced.
function computeTotal(items) {
  return items.reduce((sum, item) => sum + item.price, 0) * TAX_RATE;
}

const formatted = format(value);
```

Comments that talk to tooling rather than a reader are never flagged, no matter what text follows the marker: `eslint-disable`/`eslint-enable`/`eslint-env`, old-style `global`/`globals`/`exported` directives, `@ts-ignore`/`@ts-expect-error`/`@ts-nocheck`/`@ts-check`, `prettier-ignore`, and `c8`/`istanbul` coverage markers.

```js
// eslint-disable-next-line no-console -- console.log(startupBanner);
// @ts-expect-error narrowing this properly requires a discriminated union
/* istanbul ignore next -- defensive branch, not reachable in tests */
```

## Options

```ts
interface Options {
  /**
   * Regex source strings. A comment whose trimmed text matches any of these
   * patterns is never flagged, on top of the built-in directive-comment
   * exemptions.
   */
  allowPatterns?: string[]; // default: []
}
```

An entry in `allowPatterns` that isn't a valid regular expression (e.g. `'[test'`) is skipped rather than crashing the lint run; every other configured pattern still applies.

## When not to use it

Skip this rule in files that intentionally keep alternate implementations inline as documentation (for example, a migration guide showing before/after snippets in prose), or where a generator emits commented-out scaffolding that a later pass is expected to fill in and uncomment.

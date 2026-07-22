# tools/no-excessive-comments

Limit total free-form prose length across a single JSDoc comment.

## Why this matters for agents

Prose in a JSDoc comment is the one part of a symbol nothing verifies. The compiler checks types and the runner exercises tests, but a paragraph describing how a function "really" behaves drifts out of date the moment the code moves on - and the next agent reads that stale description as fact, copying its assumptions into new code. Long descriptions are also where an agent hides detail it never took the trouble to encode: an entire design rationale smuggled into an `@summary`, a wall of explanation stuffed behind an `@param`. Budgeting the total prose per comment forces that detail into types, tests, and names, which the toolchain keeps honest, and keeps every surviving comment short enough to stay true.

The budget counts free-form prose only. Structural content stays out of it: `{type}` expressions, `@param`/`@property` names, and `@example` code bodies never count, so precise machine-readable JSDoc never trips the rule.

## Examples

With `{ "max": 40 }`:

❌ Incorrect:

```js
/** This adds two numbers and also does a bunch of other stuff nobody bothers to document. */
export function add(a, b) {
  return a + b;
}

/**
 * @summary A summary that is far too long and clearly a place to hide a wall of text.
 */
export function total(items) {
  return items.reduce((sum, item) => sum + item, 0);
}
```

✅ Correct:

```js
/** Adds two numbers. */
export function add(a, b) {
  return a + b;
}

/**
 * @param a addend
 * @param b addend
 * @returns sum
 */
export function total(a, b) {
  return a + b;
}
```

A long `@example` is code, not prose, and is never counted:

```js
/**
 * Adds.
 * @example
 * const t = add(1, 2) + add(3, 4) + add(5, 6) + add(7, 8);
 */
export function add(a, b) {
  return a + b;
}
```

The rule inspects JSDoc block comments (`/** ... */`) only; plain block comments and line comments are out of scope.

## Options

```ts
interface Options {
  /** Maximum free-form prose characters allowed across a single JSDoc comment. */
  max?: number; // default: 250
}
```

## When not to use it

Skip this rule on files whose JSDoc is itself the deliverable - a documentation package where long, hand-written descriptions are the point rather than a substitute for types and tests.

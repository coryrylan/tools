# tools/consistent-error-messages

Require thrown/constructed `Error`s to carry a non-empty, informative message.

## Why this matters for agents

Agents under time pressure emit placeholder throw sites - `new Error()`, `new Error('')`, `new Error('error')` - that satisfy the type checker but tell whoever is debugging a production incident nothing at all. By the time that error surfaces in a log aggregator, the stack trace is often the only clue, and "error" or an empty string wastes it. Deterministic message hygiene at lint time catches this before it ships, instead of relying on a reviewer to notice a low-effort throw site among everything else in the diff.

## Examples

❌ Incorrect:

```js
throw new Error();
throw new Error('');
throw new Error('error');
throw new Error('could not open file');
```

✅ Correct:

```js
throw new Error('Cannot open config file');
throw new Error(`${path} not found`);
throw new TypeError('Expected a string, got a number');
throw new ValidationError('Missing field: name');
```

## Options

```ts
interface Options {
  /**
   * Case-insensitive denylist of exact (trimmed) messages considered
   * low-information noise. Replaces the default list entirely rather than
   * extending it.
   */
  disallow?: string[]; // default: ['error', 'err', 'failed', 'failure', 'oops', 'something went wrong', 'unknown error', 'invalid', 'bad']

  /** When true, skip the check that a message must start with a capital letter or an interpolated value. Empty and noise messages are still flagged. */
  allowLowercase?: boolean; // default: false
}
```

## When not to use it

Skip this rule where error messages are assembled dynamically in a way this rule can't analyze (e.g. every call site passes a variable or a message-building function), or in codebases with an existing i18n/error-catalog layer where the literal string at the call site is an opaque key rather than the human-facing message.

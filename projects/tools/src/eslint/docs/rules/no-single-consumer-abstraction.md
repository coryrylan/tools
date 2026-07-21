# tools/no-single-consumer-abstraction

Disallow exported abstractions (base classes) that have fewer than two implementation consumers, so shared abstractions are introduced only once at least two callers actually need them.

## Why this matters for agents

Coding agents reach for a base class the moment they write the _first_ implementation of something - "this is probably reusable, let me extract a `BaseFoo`." The result is a one-subclass hierarchy: an extra file, an extra indirection, and an abstraction whose real shape is guessed from a single example instead of discovered from two.

Premature abstractions are expensive to unwind because every future edit has to reason about the base/derived split even though only one thing ever derives from it. The cheaper default is to inline the code into its single consumer and extract a base _later_, when a second consumer proves what the abstraction should actually be. This rule enforces that "wait for two" discipline: an `abstract class` (or a `Base…`/`…Base`-named class) that only one implementation extends is flagged until a second consumer appears.

## Examples

Examples assume the default configuration.

❌ **Incorrect** - an abstract base with a single consumer:

```ts
// src/toggle/toggle-base.ts
export abstract class ToggleBase {
  abstract toggle(): void;
}

// src/toggle/switch.ts
import { ToggleBase } from './toggle-base.js';
export class Switch extends ToggleBase {
  toggle() {}
}
// No other class extends ToggleBase → the abstraction has 1 consumer.
```

❌ **Incorrect** - a `Base…`-named class nobody extends yet:

```ts
// src/overlay/base-overlay.ts
export class BaseOverlay {} // 0 consumers
```

✅ **Correct** - inline the single implementation until a second consumer needs the base:

```ts
// src/toggle/switch.ts
export class Switch {
  toggle() {}
}
```

✅ **Correct** - an abstract base that two implementations extend:

```ts
// src/toggle/toggle-base.ts
export abstract class ToggleBase {
  abstract toggle(): void;
}

// src/toggle/switch.ts
import { ToggleBase } from './toggle-base.js';
export class Switch extends ToggleBase {
  toggle() {}
}

// src/toggle/checkbox.ts
import { ToggleBase } from './toggle-base.js';
export class Checkbox extends ToggleBase {
  toggle() {}
}
// 2 consumers → the abstraction is justified.
```

## Options

This rule takes a single options object:

```jsonc
{
  "tools/no-single-consumer-abstraction": ["error", {
    "minimumConsumers": 2,
    "detectAbstract": true,
    "namePatterns": ["^Base", "Base$"],
    "include": ["src/**"],
    "exclude": [],
    "extensions": [".ts", ".tsx", ".js"],
    "rootDir": "/abs/path/to/package"
  }]
}
```

| Option             | Type               | Default                  | Description                                                                                                                                                                                           |
| ------------------ | ------------------ | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `minimumConsumers` | `number` (min `2`) | `2`                      | An abstraction is reported when it has fewer than this many implementation consumers.                                                                                                                 |
| `detectAbstract`   | `boolean`          | `true`                   | When `true`, any exported `abstract` class is treated as a candidate abstraction. Set to `false` to rely on `namePatterns` alone.                                                                     |
| `namePatterns`     | `string[]`         | `["^Base", "Base$"]`     | Regular-expression sources. An exported class whose name matches any pattern is treated as a candidate (in addition to `abstract` classes when `detectAbstract` is on). Invalid patterns are ignored. |
| `include`          | `string[]`         | `["src/**"]`             | Glob patterns, relative to the package root, selecting which linted files the rule activates on. A file must match at least one pattern.                                                              |
| `exclude`          | `string[]`         | `[]`                     | Glob patterns, relative to the package root, that opt files back out. `node_modules` and `dist` are always excluded implicitly.                                                                       |
| `extensions`       | `string[]`         | `[".ts", ".tsx", ".js"]` | File extensions that are both linted and scanned for consumers. `.d.ts` files are always skipped.                                                                                                     |
| `rootDir`          | `string`           | inferred                 | Absolute path to the package root. When omitted, the root is discovered by walking up from the linted file to the nearest directory containing both `package.json` and `src`.                         |

Globs support `*` (matches within a path segment), `**` (matches across segments, including none), and `?` (matches a single character). Paths are normalized to `/` before matching, so patterns are written with forward slashes on every platform.

A "consumer" is a class that `extends` the candidate - found in the same file, or in another package file that imports the candidate via a named, aliased (`as`), namespace (`* as`), default, or package-barrel import. Both the candidate and the consumer count are derived per candidate class, so a file can hold several abstractions independently.

Import specifiers are matched against every extension convention a consumer might reasonably use for the candidate's file, not just one: extensionless (bundler resolution), `.js` (the NodeNext "import the compiled output extension" convention), `.ts` (`allowImportingTsExtensions`), and - when the candidate lives in a `.tsx` file - `.jsx`/`.tsx` as well. A package is free to mix these conventions across files; the rule does not assume one.

## When not to use it

- **Framework/library base classes are the intended public API.** If your package deliberately ships base classes for _external_ subclassers, their in-repo consumer count is not a meaningful signal - scope the rule away from those files with `exclude`, or disable it there.
- **You extend without a lexical `extends`.** Consumer detection is based on `class … extends …`. Abstractions consumed purely through mixins, composition, or dynamic subclassing are not counted and will be false-positives.
- **Declaration merging or non-standard layouts.** If your package does not resolve to a single `package.json` + `src` root (monorepo edge cases, virtual files), set `rootDir` explicitly or turn the rule off for those files.

## How it scans

To decide a candidate's consumer count, this rule reads sibling source files from disk. Consumers deserve to know that a lint rule touches files other than the one being linted, so the behavior is spelled out here:

- **Root resolution.** The package root is taken from the `rootDir` option, or inferred by walking up the directory tree from the linted file to the first directory that contains both `package.json` and `src`. If no root can be resolved, the rule deactivates for that file and reports nothing.
- **Activation.** The rule only runs on files that match `include`, do not match `exclude`, are not under `node_modules`/`dist`, carry one of `extensions`, and are not `.d.ts`. A file outside the resolved root (or otherwise unmatched) is skipped without error.
- **The scan.** For each candidate class, every source file under the root (subject to the same `include`/`exclude`/`extensions` filtering) is read and matched with lightweight text patterns to count `extends` clauses that resolve to the candidate - including through the package barrel (`src/index.*` or `index.*` re-exporting the class, imported via the bare package name).
- **The cache.** The recursive directory listing for a root is cached in memory, keyed by the normalized root path, for 5 seconds (`FILE_CACHE_TTL_MS`). That's long enough to amortize repeated lookups across every candidate class in one lint pass, and short enough that a long-lived process (an IDE language server, `eslint_d`, watch mode) picks up a file added or removed on disk within about one save-and-relint cycle - no process restart required. Command-line lint runs (a fresh process each time) always see current files regardless.
- **Resilience.** Unreadable directories and files, and malformed `package.json`/patterns, are skipped rather than thrown - the scan never crashes a lint run, it only counts fewer consumers.

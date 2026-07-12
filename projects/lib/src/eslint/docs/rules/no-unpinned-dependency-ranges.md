# tools/no-unpinned-dependency-ranges

Require `package.json` dependency version specifiers appropriate to the package's publish status and dependency kind.

## Why this matters for agents

`pnpm add <package>` (and most other package managers) writes whatever specifier style the tool defaults to - usually a `^` range - regardless of whether that's the right choice for _this_ dependency in _this_ package. Agents run that command (or hand-edit `package.json`) constantly, and have no innate sense of the asymmetry between a private, unpublished package (where a range only adds nondeterminism to installs, since there's no downstream consumer to deduplicate for) and a published one (where runtime dependencies need a range so consumers _can_ dedupe, but devDependencies - which never ship - should stay pinned for reproducibility).

Getting this backwards doesn't fail a build; it just makes installs slightly less reproducible or slightly worse for downstream deduplication, in a way nobody notices until much later. Catching it in the diff, at the moment the dependency is added, is far cheaper than catching it during a release audit.

## Examples

❌ Incorrect

`package.json`, `private: true` - ranges are never allowed once there's no consumer to dedupe for:

```json
{
  "private": true,
  "dependencies": { "left-pad": "^1.3.0" }
}
```

`package.json`, published - an unpinned devDependency makes installs non-reproducible:

```json
{
  "name": "@acme/widgets",
  "devDependencies": { "vitest": "^4.1.0" }
}
```

`package.json`, published - a pinned runtime dependency prevents consumer deduplication:

```json
{
  "name": "@acme/widgets",
  "dependencies": { "lodash": "4.17.21" }
}
```

✅ Correct

```json
{
  "private": true,
  "dependencies": { "left-pad": "1.3.0" }
}
```

```json
{
  "name": "@acme/widgets",
  "devDependencies": { "vitest": "4.1.0" },
  "dependencies": { "lodash": "^4.17.21" }
}
```

## Options

This rule takes a single options object:

| Option         | Type      | Default | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------- | --------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `allowCatalog` | `boolean` | `true`  | Whether pnpm's `catalog:` protocol (`catalog:`, `catalog:publish`, or a named catalog) is accepted unconditionally, bypassing the pinned/range checks below. Set to `false` to make `catalog:` specifiers subject to the same rules as any other version string - since `catalog:*` isn't a `^`/`~` range, that makes it count as "pinned" for private packages and devDependencies, but makes it _fail_ the "needs a range" check for published runtime dependencies. |

The pinned-vs-range rule itself isn't configurable:

- **Private packages** (`"private": true`): every dependency, in every group (`dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`), must be pinned to an exact version, or use a `workspace:*` link.
- **Published packages**: `dependencies`, `peerDependencies`, and `optionalDependencies` must use a range (`^`/`~`, or a concrete `workspace:` range like `workspace:^`) so consumers can deduplicate; `devDependencies` must stay pinned, since they never ship to consumers.

## When not to use it

Don't enable this rule if:

- Your workspace doesn't distinguish private vs. published packages in a way this rule's `private` field check can see (e.g. publish status is decided by a separate allowlist rather than `package.json#private`).
- You don't use pnpm's `catalog:` protocol and want one fewer option to think about - leaving `allowCatalog` at its default `true` is harmless either way, since it only special-cases a specifier prefix (`catalog:`) that won't appear in `package.json` files that don't use catalogs.
- You intentionally pin runtime dependencies in a published package for reasons that outweigh consumer deduplication (rare, but occasionally deliberate) - this rule has no per-dependency escape hatch, only a blanket policy.

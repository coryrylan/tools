# vite

Vite build config factories and plugins for shipping a library as ESM-only, per-module output.

## Usage

```ts
// vite.config.ts
import { mergeConfig } from 'vite';
import { createNodeLibraryBuildConfig } from '@coryrylan/tools/vite';

export default mergeConfig(
  createNodeLibraryBuildConfig({
    entry: { index: 'src/index.ts' },
  }),
  {
    // Project-specific additions - plugins, resolve aliases, etc.
  },
);
```

Building for a browser runtime instead of Node.js: swap in `createBrowserLibraryBuildConfig` from the same entry point. Both factories return a plain `UserConfig`, so `mergeConfig` is how a consumer layers anything project-specific on top rather than reconstructing the shape by hand.

## Build config factories

`createNodeLibraryBuildConfig` and `createBrowserLibraryBuildConfig` encode one library-build preset each:

- **ESM-only.** `formats: ['es']` - no `cjs`/`umd`/`iife` output to maintain.
- **Everything external.** Every bare specifier (`lit`, `node:path`, `@scope/pkg`) is externalized; only relative and absolute specifiers get bundled. A dependency stays a real `package.json` dependency instead of getting inlined, so tree-shaking stays viable downstream.
- **`preserveModules`.** `dist` mirrors `src` 1:1 - one output file per source module instead of a single bundle - which lets `package.json#exports` map deep-import paths straight to build output.
- **No minification.** Library output is read by tooling (bundlers, type checkers) more often than it's shipped to a browser tab; minifying it only makes diffs and stack traces harder to read for no runtime benefit at the point this package builds.

The two factories differ only in `build.target`: `node22` for `createNodeLibraryBuildConfig`, `esnext` for `createBrowserLibraryBuildConfig` - the browser variant leaves downlevel compilation to whatever consumes the package, since it has no single runtime baseline to target.

## Plugins

### `write-if-changed`

```ts
import { writeIfChanged } from '@coryrylan/tools/vite/plugins/write-if-changed';
```

Only writes a bundle chunk to disk when its content differs from the last write. Uses `writeBundle` rather than `generateBundle` for Rolldown compatibility - Rolldown doesn't support mutating the bundle object in place. Skipping identical writes avoids the file-watcher churn (HMR reloads, downstream rebuilds) an unchanged-but-rewritten file would otherwise trigger.

| Option   | Type     | Default | Description                                                                                               |
| -------- | -------- | ------- | --------------------------------------------------------------------------------------------------------- |
| `outDir` | `string` | -       | Output directory to resolve chunk file names against, used only when Rollup's own `output.dir` isn't set. |

### `dts`

```ts
import { dts } from '@coryrylan/tools/vite/plugins/dts';
```

Runs the consuming project's own TypeScript compiler at build start so declaration files ship with every build instead of drifting out of sync with a separately run type-check step. Resolves the compiler from the consumer's dependency tree (not this package's), so `compilerPackage: 'typescript-go'` works too - the native-compiler alias a consumer may have installed instead of (or alongside) `typescript`. The compiler runs asynchronously, and `vite build --watch` rebuilds pass `--incremental` with build info kept at `<outDir>/.tsbuildinfo` instead of type-checking from scratch on every rebuild. After compiling, copies any hand-written `.d.ts` files under `src` (ambient module declarations, for example) into `outDir`, since `tsc` only emits declarations for `.ts` sources.

| Option            | Type     | Default                 | Description                                                                       |
| ----------------- | -------- | ----------------------- | --------------------------------------------------------------------------------- |
| `project`         | `string` | `'tsconfig.build.json'` | Path to the tsconfig used for declaration emit, resolved against `process.cwd()`. |
| `outDir`          | `string` | `'dist'`                | Directory declarations are emitted into, resolved against `process.cwd()`.        |
| `compilerPackage` | `string` | `'typescript'`          | Package providing the `bin/tsc` entry point to shell out to.                      |

If `compilerPackage` can't be resolved from the consumer's dependency tree, this warns and no-ops rather than failing the build.

## Peer requirements

- `vite >=8` - optional peer; only needed if you import from this entry point.

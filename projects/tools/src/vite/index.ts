import type { LibraryOptions, UserConfig } from 'vite';

/** Options for {@link createNodeLibraryBuildConfig}. */
export interface NodeLibraryBuildConfigOptions {
  readonly entry: LibraryOptions['entry'];
}

/** Options for {@link createBrowserLibraryBuildConfig}. */
export interface BrowserLibraryBuildConfigOptions {
  readonly entry: LibraryOptions['entry'];
}

/**
 * The build shape both factories below share: ESM-only, every bare
 * specifier externalized (a dependency stays a real `package.json`
 * dependency instead of getting inlined, so tree-shaking stays viable
 * downstream), and `preserveModules` so `dist` mirrors `src` 1:1 - one
 * output file per source module, which is what lets `package.json#exports`
 * map deep-import paths straight to build output.
 */
function createLibraryBuildConfig(target: 'node22' | 'esnext', entry: LibraryOptions['entry']): UserConfig {
  return {
    build: {
      target,
      minify: false,
      lib: { entry, formats: ['es'] },
      rollupOptions: {
        external: id => !id.startsWith('.') && !id.startsWith('/'),
        output: {
          preserveModules: true,
          preserveModulesRoot: 'src',
          entryFileNames: '[name].js'
        }
      }
    }
  };
}

/**
 * Vite build config for a Node.js library entry point: ESM output only,
 * targets `node22`, and never bundles a dependency - every bare specifier
 * (`lit`, `node:path`, `@scope/pkg`) is externalized. `preserveModules`
 * keeps one output file per source module instead of one monolithic
 * bundle, so `package.json#exports` can expose deep-import paths.
 *
 * Extend it with `mergeConfig` rather than hand-rolling the shape again:
 *
 * ```ts
 * import { mergeConfig } from 'vite';
 * import { createNodeLibraryBuildConfig } from '@coryrylan/tools/vite';
 *
 * export default mergeConfig(
 *   createNodeLibraryBuildConfig({ entry: { index: 'src/index.ts' } }),
 *   { plugins: [] },
 * );
 * ```
 */
export function createNodeLibraryBuildConfig(options: NodeLibraryBuildConfigOptions): UserConfig {
  return createLibraryBuildConfig('node22', options.entry);
}

/**
 * Vite build config for a browser library entry point. Same shape as
 * {@link createNodeLibraryBuildConfig} - ESM-only, everything external,
 * `preserveModules` - except it targets `esnext` instead of a Node.js
 * runtime, since the consuming browser (or a downstream bundler) declares
 * its own compilation baseline.
 */
export function createBrowserLibraryBuildConfig(options: BrowserLibraryBuildConfigOptions): UserConfig {
  return createLibraryBuildConfig('esnext', options.entry);
}

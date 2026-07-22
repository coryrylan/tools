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
 * specifier externalized (keeps tree-shaking viable downstream), and
 * `preserveModules` so `dist` mirrors `src` 1:1 for `package.json#exports`
 * deep-import paths.
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
 * Vite build config for a Node.js library entry point: ESM-only, targets
 * `node22`, externalizes every bare specifier, and preserves one output
 * file per source module for `package.json#exports` deep imports.
 *
 * @example
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
 * {@link createNodeLibraryBuildConfig} except it targets `esnext`, since the
 * consuming browser (or downstream bundler) declares its own baseline.
 */
export function createBrowserLibraryBuildConfig(options: BrowserLibraryBuildConfigOptions): UserConfig {
  return createLibraryBuildConfig('esnext', options.entry);
}

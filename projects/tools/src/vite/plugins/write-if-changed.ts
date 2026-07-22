import { extname, resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Plugin } from 'vite';

// Module-level so the cache survives across the plugin's own hook
// invocations within one process but starts empty on every new build.
const writtenFileContentsByPath = new Map<string, string>();

/** Options for {@link writeIfChanged}. */
export interface WriteIfChangedPluginOptions {
  /**
   * Output directory to resolve emitted chunk file names against. Only
   * consulted when Rollup's own `output.dir` isn't set on the build.
   */
  readonly outDir?: string;
}

/**
 * Vite plugin that only writes bundle files if content changed, avoiding
 * file-watcher/HMR churn on a byte-identical rebuild. Uses `writeBundle`
 * not `generateBundle`: Rolldown can't mutate the bundle, so the write
 * happens after Rollup's own write step.
 */
export function writeIfChanged(options: WriteIfChangedPluginOptions = {}): Plugin {
  return {
    name: 'write-if-changed',
    writeBundle(outputOptions, bundle) {
      const dir = outputOptions.dir ?? options.outDir;
      // No configured output directory means nowhere to write - warn+no-op
      // is the house style, and here there isn't even anything actionable
      // to warn about, so this stays a silent no-op.
      if (dir === undefined) return;

      for (const bundleFile of Object.values(bundle)) {
        if (bundleFile.type !== 'chunk' || extname(bundleFile.fileName) !== '.js') continue;

        const filePath = resolve(dir, bundleFile.fileName);
        if (writtenFileContentsByPath.get(filePath) === bundleFile.code) continue;

        writtenFileContentsByPath.set(filePath, bundleFile.code);
        mkdirSync(resolve(filePath, '..'), { recursive: true });
        writeFileSync(filePath, bundleFile.code);
      }
    }
  };
}

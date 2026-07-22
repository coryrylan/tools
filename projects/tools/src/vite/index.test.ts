import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build, mergeConfig } from 'vite';
import type { UserConfig } from 'vite';
import { createBrowserLibraryBuildConfig, createNodeLibraryBuildConfig } from './index.js';

// Scratch space lives under the package's own `node_modules/.cache` (rather
// than `os.tmpdir()`) so fixtures stay reachable by Node's module resolution
// walking up through this package's `node_modules` - needed by sibling
// tests in this surface that resolve a real compiler package from a fixture.
const scratchRoot = resolve(import.meta.dirname, '../../node_modules/.cache/coryrylan-tools-tests');

type ExternalPredicate = (id: string) => boolean;
type RollupOptions = NonNullable<NonNullable<UserConfig['build']>['rollupOptions']>;

/**
 * `build.rollupOptions` is `@deprecated` in favor of `rolldownOptions`
 * (Vite 8's Rolldown migration), but it is the field these factories
 * populate, matching the existing `vite.config.ts` pattern - suppressed
 * once here instead of every call site below.
 */
function getRollupOptions(config: UserConfig): RollupOptions {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- intentional: this package's factories populate the deprecated `rollupOptions` field to match the existing vite.config.ts pattern; see getRollupOptions JSDoc.
  const rollupOptions = config.build?.rollupOptions;
  if (rollupOptions === undefined) {
    throw new Error('Expected build.rollupOptions to be configured.');
  }
  return rollupOptions;
}

/**
 * Narrowly casts `rollupOptions.external` to a callable predicate. The
 * production type also allows a string, `RegExp`, or array - these
 * factories always configure a function, so `typeof` documents that
 * assumption instead of an `any` cast.
 */
function getExternalPredicate(config: UserConfig): ExternalPredicate {
  const external = getRollupOptions(config).external;
  if (typeof external !== 'function') {
    throw new Error('Expected rollupOptions.external to be configured as a function.');
  }
  return external as unknown as ExternalPredicate;
}

describe('createNodeLibraryBuildConfig', () => {
  it('should target node22 with ESM-only, unminified, preserveModules output', () => {
    const config = createNodeLibraryBuildConfig({ entry: { index: 'src/index.ts' } });

    expect(config.build?.target).toBe('node22');
    expect(config.build?.minify).toBe(false);
    expect(config.build?.lib).toEqual({ entry: { index: 'src/index.ts' }, formats: ['es'] });
    expect(getRollupOptions(config).output).toMatchObject({
      preserveModules: true,
      preserveModulesRoot: 'src',
      entryFileNames: '[name].js'
    });
  });

  it('should pass the entry option through unchanged', () => {
    const entry = { index: 'src/index.ts', 'plugins/foo': 'src/plugins/foo.ts' };

    const config = createNodeLibraryBuildConfig({ entry });

    expect(config.build?.lib).toMatchObject({ entry });
  });
});

describe('createBrowserLibraryBuildConfig', () => {
  it('should target esnext with the same ESM-only, preserveModules shape', () => {
    const config = createBrowserLibraryBuildConfig({ entry: { index: 'src/index.ts' } });

    expect(config.build?.target).toBe('esnext');
    expect(config.build?.minify).toBe(false);
    expect(config.build?.lib).toEqual({ entry: { index: 'src/index.ts' }, formats: ['es'] });
    expect(getRollupOptions(config).output).toMatchObject({
      preserveModules: true,
      preserveModulesRoot: 'src',
      entryFileNames: '[name].js'
    });
  });
});

describe('externalization predicate', () => {
  it('should externalize bare specifiers and keep relative/absolute specifiers bundled', () => {
    const external = getExternalPredicate(createNodeLibraryBuildConfig({ entry: { index: 'src/index.ts' } }));

    expect(external('lit')).toBe(true);
    expect(external('node:path')).toBe(true);
    expect(external('@scope/pkg')).toBe(true);
    expect(external('./x.js')).toBe(false);
    expect(external('/abs/path')).toBe(false);
  });
});

describe('createNodeLibraryBuildConfig (real build)', () => {
  it('should externalize bare imports and preserve per-module output files in a real vite build', async () => {
    mkdirSync(scratchRoot, { recursive: true });
    const fixture = mkdtempSync(join(scratchRoot, 'node-library-build-'));

    try {
      mkdirSync(join(fixture, 'src'), { recursive: true });
      // `helperValue` takes an argument and reads a runtime value so
      // Rolldown can't constant-fold the call across the module boundary
      // and collapse `helper.ts` into `index.ts` - the point of this
      // fixture is to observe `preserveModules` keeping them as separate
      // output files, which a fully inlined constant would defeat.
      writeFileSync(
        join(fixture, 'src/helper.ts'),
        ['export function helperValue(seed: number): number {', '  return seed + (Date.now() % 2);', '}', ''].join('\n')
      );
      writeFileSync(
        join(fixture, 'src/index.ts'),
        [
          "import { join } from 'node:path';",
          "import { helperValue } from './helper.js';",
          "export const joined = join('a', String(helperValue(1)));",
          ''
        ].join('\n')
      );

      await build(
        mergeConfig(createNodeLibraryBuildConfig({ entry: { index: resolve(fixture, 'src/index.ts') } }), {
          root: fixture,
          logLevel: 'silent',
          build: { outDir: resolve(fixture, 'dist') }
        })
      );

      const indexOutput = readFileSync(join(fixture, 'dist/index.js'), 'utf8');
      expect(existsSync(join(fixture, 'dist/helper.js'))).toBe(true);
      expect(indexOutput).toContain('node:path');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }, 30_000);
});

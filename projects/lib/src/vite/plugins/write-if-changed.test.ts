import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Plugin, Rollup } from 'vite';
import { writeIfChanged } from './write-if-changed.js';

const scratchRoot = resolve(import.meta.dirname, '../../../node_modules/.cache/coryrylan-tools-tests');

interface FakeOutputChunk {
  readonly type: 'chunk';
  readonly fileName: string;
  readonly code: string;
}

interface FakeOutputAsset {
  readonly type: 'asset';
  readonly fileName: string;
}

type WriteBundleHandler = (outputOptions: Rollup.NormalizedOutputOptions, bundle: Rollup.OutputBundle) => void;

/**
 * Narrowly casts the plugin's `writeBundle` hook to a directly callable
 * function. The real hook type requires a `PluginContext` `this` binding
 * (needed only when Rollup itself invokes the hook as a method) and allows
 * an async return - this plugin's implementation reads neither `this` nor
 * ever returns a promise, so binding a fake `this` and discarding the
 * return value reflects the real contract under test, not an assertion
 * away of a type error.
 */
function getWriteBundleHandler(plugin: Plugin): WriteBundleHandler {
  const hook = plugin.writeBundle;
  if (typeof hook !== 'function') {
    throw new Error('Expected write-if-changed to define writeBundle as a plain function.');
  }
  const fakePluginContext = undefined as unknown as Rollup.PluginContext;
  return (outputOptions, bundle) => {
    void hook.call(fakePluginContext, outputOptions, bundle);
  };
}

/** Builds a minimal fake `NormalizedOutputOptions`, cast narrowly rather than satisfying its full shape. */
function toFakeOutputOptions(dir: string | undefined): Rollup.NormalizedOutputOptions {
  return { dir } as unknown as Rollup.NormalizedOutputOptions;
}

/** Builds a minimal fake `OutputBundle` out of realistic chunk/asset stand-ins, cast narrowly rather than satisfying their full shape. */
function toFakeBundle(entries: Record<string, FakeOutputChunk | FakeOutputAsset>): Rollup.OutputBundle {
  return entries as unknown as Rollup.OutputBundle;
}

describe('writeIfChanged', () => {
  let outDir: string;

  beforeEach(() => {
    mkdirSync(scratchRoot, { recursive: true });
    outDir = mkdtempSync(join(scratchRoot, 'write-if-changed-'));
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it('should write a new chunk file to disk on the first bundle', () => {
    const handler = getWriteBundleHandler(writeIfChanged());

    handler(
      toFakeOutputOptions(outDir),
      toFakeBundle({ 'index.js': { type: 'chunk', fileName: 'index.js', code: 'export const a = 1;' } })
    );

    expect(readFileSync(join(outDir, 'index.js'), 'utf8')).toBe('export const a = 1;');
  });

  it('should not rewrite the file when the chunk code is unchanged', () => {
    const handler = getWriteBundleHandler(writeIfChanged());
    const bundle = toFakeBundle({ 'index.js': { type: 'chunk', fileName: 'index.js', code: 'export const a = 1;' } });
    handler(toFakeOutputOptions(outDir), bundle);

    // Back-date the mtime so an *unchanged* mtime on the second call is
    // actually meaningful evidence the file wasn't rewritten, instead of
    // coincidentally landing within the filesystem's mtime resolution.
    const filePath = join(outDir, 'index.js');
    const backdated = new Date(Date.now() - 60_000);
    utimesSync(filePath, backdated, backdated);
    const mtimeBeforeSecondCall = statSync(filePath).mtimeMs;

    handler(toFakeOutputOptions(outDir), bundle);

    expect(statSync(filePath).mtimeMs).toBe(mtimeBeforeSecondCall);
  });

  it('should rewrite the file when the chunk code changes', () => {
    const handler = getWriteBundleHandler(writeIfChanged());
    handler(
      toFakeOutputOptions(outDir),
      toFakeBundle({ 'index.js': { type: 'chunk', fileName: 'index.js', code: 'export const a = 1;' } })
    );

    handler(
      toFakeOutputOptions(outDir),
      toFakeBundle({ 'index.js': { type: 'chunk', fileName: 'index.js', code: 'export const a = 2;' } })
    );

    expect(readFileSync(join(outDir, 'index.js'), 'utf8')).toBe('export const a = 2;');
  });

  it('should ignore bundle entries that are assets or non-.js chunks', () => {
    const handler = getWriteBundleHandler(writeIfChanged());

    handler(
      toFakeOutputOptions(outDir),
      toFakeBundle({
        'styles.css': { type: 'asset', fileName: 'styles.css' },
        'index.js.map': { type: 'chunk', fileName: 'index.js.map', code: '{}' }
      })
    );

    expect(existsSync(join(outDir, 'styles.css'))).toBe(false);
    expect(existsSync(join(outDir, 'index.js.map'))).toBe(false);
  });

  it('should no-op without throwing when neither output.dir nor the outDir option is set', () => {
    const handler = getWriteBundleHandler(writeIfChanged());

    expect(() => {
      handler(
        toFakeOutputOptions(undefined),
        toFakeBundle({ 'index.js': { type: 'chunk', fileName: 'index.js', code: 'x' } })
      );
    }).not.toThrow();
  });

  it('should fall back to the outDir option when output.dir is not set', () => {
    const handler = getWriteBundleHandler(writeIfChanged({ outDir }));

    handler(
      toFakeOutputOptions(undefined),
      toFakeBundle({ 'index.js': { type: 'chunk', fileName: 'index.js', code: 'x' } })
    );

    expect(readFileSync(join(outDir, 'index.js'), 'utf8')).toBe('x');
  });
});

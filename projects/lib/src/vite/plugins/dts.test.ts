import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import { dts } from './dts.js';

// Scratch space lives under this package's own `node_modules/.cache` (not
// `os.tmpdir()`) so a fixture's `require.resolve('typescript/...')` walks up
// through real ancestor `node_modules` directories and lands on this
// package's own `typescript` dependency instead of failing to resolve.
const scratchRoot = resolve(import.meta.dirname, '../../../node_modules/.cache/coryrylan-tools-tests');

type BuildStartHandler = () => void | Promise<void>;

/**
 * Narrowly casts the plugin's `buildStart` hook to a directly callable
 * function - the hook takes no arguments, so only the callable shape (not
 * `this`) matters for a direct unit-test invocation.
 */
function getBuildStartHandler(plugin: Plugin): BuildStartHandler {
  const hook = plugin.buildStart;
  if (typeof hook !== 'function') {
    throw new Error('Expected dts to define buildStart as a plain function.');
  }
  return hook as unknown as BuildStartHandler;
}

type ConfigResolvedHandler = (config: ResolvedConfig) => void | Promise<void>;

/** Same narrowing as {@link getBuildStartHandler}, for the configResolved hook. */
function getConfigResolvedHandler(plugin: Plugin): ConfigResolvedHandler {
  const hook = plugin.configResolved;
  if (typeof hook !== 'function') {
    throw new Error('Expected dts to define configResolved as a plain function.');
  }
  return hook;
}

describe('dts', () => {
  let fixture: string;
  let originalCwd: string;

  beforeEach(() => {
    mkdirSync(scratchRoot, { recursive: true });
    fixture = mkdtempSync(join(scratchRoot, 'dts-'));
    mkdirSync(join(fixture, 'src'), { recursive: true });

    writeFileSync(join(fixture, 'package.json'), JSON.stringify({ name: 'fixture', type: 'module' }, null, 2));
    writeFileSync(
      join(fixture, 'tsconfig.build.json'),
      JSON.stringify(
        {
          compilerOptions: {
            declaration: true,
            emitDeclarationOnly: true,
            module: 'esnext',
            target: 'esnext',
            moduleResolution: 'bundler',
            strict: true,
            rootDir: 'src',
            // Overridden by the plugin's own `--outDir` CLI flag; kept here
            // only so the tsconfig is valid on its own.
            outDir: 'dist'
          },
          include: ['src']
        },
        null,
        2
      )
    );
    writeFileSync(join(fixture, 'src/value.ts'), 'export const value: number = 1;\n');
    writeFileSync(join(fixture, 'src/extra.d.ts'), 'export declare const extra: string;\n');

    originalCwd = process.cwd();
    process.chdir(fixture);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(fixture, { recursive: true, force: true });
  });

  it('should compile declarations with the consumer tsconfig and copy hand-written .d.ts files into outDir', async () => {
    const handler = getBuildStartHandler(dts({ compilerPackage: 'typescript' }));

    await handler();

    expect(existsSync(join(fixture, 'dist/value.d.ts'))).toBe(true);
    expect(readFileSync(join(fixture, 'dist/extra.d.ts'), 'utf8')).toBe('export declare const extra: string;\n');
    expect(existsSync(join(fixture, 'dist/.tsbuildinfo'))).toBe(false);
  }, 30_000);

  it('should reuse incremental build info across watch-mode rebuilds', async () => {
    const plugin = dts({ compilerPackage: 'typescript' });
    void getConfigResolvedHandler(plugin)({ build: { watch: {} } } as unknown as ResolvedConfig);
    const handler = getBuildStartHandler(plugin);

    await handler();

    expect(existsSync(join(fixture, 'dist/value.d.ts'))).toBe(true);
    expect(existsSync(join(fixture, 'dist/.tsbuildinfo'))).toBe(true);

    writeFileSync(join(fixture, 'src/second.ts'), 'export const second: number = 2;\n');
    await handler();

    expect(existsSync(join(fixture, 'dist/second.d.ts'))).toBe(true);
  }, 60_000);

  it('should reject when the typecheck fails', async () => {
    writeFileSync(join(fixture, 'src/broken.ts'), "export const broken: number = 'nope';\n");
    const handler = getBuildStartHandler(dts({ compilerPackage: 'typescript' }));

    await expect(handler()).rejects.toThrow('tsc exited with code');
  }, 30_000);

  it('should warn and no-op instead of throwing when compilerPackage cannot be resolved', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const handler = getBuildStartHandler(dts({ compilerPackage: 'not-a-real-compiler-pkg' }));

    await expect(handler()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('not-a-real-compiler-pkg'));
    expect(existsSync(join(fixture, 'dist'))).toBe(false);

    warnSpy.mockRestore();
  });
});

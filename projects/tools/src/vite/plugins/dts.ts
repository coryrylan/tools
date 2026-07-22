import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Plugin } from 'vite';

const DEFAULT_PROJECT = 'tsconfig.build.json';
const DEFAULT_OUT_DIR = 'dist';
const DEFAULT_COMPILER_PACKAGE = 'typescript';

/** Options for {@link dts}. */
export interface DtsPluginOptions {
  /** Path to the `tsconfig` used for declaration emit, resolved against `process.cwd()`. @default 'tsconfig.build.json' */
  readonly project?: string;
  /** Directory declarations are emitted into, resolved against `process.cwd()`. @default 'dist' */
  readonly outDir?: string;
  /** Package providing the `bin/tsc` entry point to shell out to - swap in `'typescript-go'` for the native compiler alias. @default 'typescript' */
  readonly compilerPackage?: string;
}

/**
 * Resolves `<compilerPackage>/bin/tsc` from the *consuming* project's
 * dependency tree, not this package's - a monorepo consumer commonly pins a
 * different TypeScript (or `typescript-go`) than this package built with.
 */
function resolveTscBinaryPath(compilerPackage: string): string | undefined {
  try {
    const consumerRequire = createRequire(pathToFileURL(join(process.cwd(), 'package.json')));
    const compilerPackageJsonPath = consumerRequire.resolve(`${compilerPackage}/package.json`);
    return resolve(dirname(compilerPackageJsonPath), 'bin/tsc');
  } catch {
    return undefined;
  }
}

/**
 * Copies every hand-written `src/**\/*.d.ts` (excluding `*.test.d.ts`) into
 * `outDir`, preserving its path relative to `srcDir` - `tsc` only emits
 * declarations for `.ts` sources, so hand-authored `.d.ts` never reaches
 * the build output on its own.
 */
function copyHandWrittenDeclarationFiles(srcDir: string, outDir: string): void {
  if (!existsSync(srcDir)) return;

  const declarationFilePaths = readdirSync(srcDir, { recursive: true })
    .filter((entry): entry is string => typeof entry === 'string')
    .filter(entry => entry.endsWith('.d.ts') && !entry.endsWith('.test.d.ts'));

  for (const relativePath of declarationFilePaths) {
    const destination = resolve(outDir, relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(resolve(srcDir, relativePath), destination);
  }
}

/**
 * Runs the resolved tsc binary without blocking the event loop. Rejects on a
 * nonzero exit so type errors fail the build - the one exception to this
 * package's warn-and-no-op rule, since a skipped typecheck would publish
 * broken declarations.
 */
function runTsc(args: string[]): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit' });
    child.on('error', rejectPromise);
    child.on('close', code => {
      if (code === 0) {
        resolvePromise();
      } else {
        // eslint-disable-next-line tools/consistent-error-messages -- 'tsc' is the compiler binary's actual (lowercase) name, and dts.test.ts asserts this exact substring
        rejectPromise(new Error(`tsc exited with code ${String(code)}`));
      }
    });
  });
}

/**
 * Generates a library's type declarations via the consumer's own tsc (or
 * `typescript-go`). Copies hand-written `.d.ts` files tsc wouldn't emit;
 * watch builds add `--incremental` caching. Warns and no-ops if
 * `compilerPackage` can't be resolved.
 */
export function dts(options: DtsPluginOptions = {}): Plugin {
  const project = options.project ?? DEFAULT_PROJECT;
  const outDir = options.outDir ?? DEFAULT_OUT_DIR;
  const compilerPackage = options.compilerPackage ?? DEFAULT_COMPILER_PACKAGE;
  let isWatchBuild = false;

  return {
    name: 'dts',
    apply: 'build',
    configResolved(config) {
      isWatchBuild = config.build.watch !== null;
    },
    async buildStart() {
      const cwd = process.cwd();
      const tscPath = resolveTscBinaryPath(compilerPackage);
      if (tscPath === undefined) {
        console.warn(
          `[@coryrylan/tools/vite] Could not resolve compiler package "${compilerPackage}" from ${cwd} - skipping declaration generation.`
        );
        return;
      }

      const projectPath = resolve(cwd, project);
      const outDirPath = resolve(cwd, outDir);
      // Watch rebuilds reuse tsc's incremental state. The build info lives
      // inside outDir so cleaning the output also resets the cache - a stale
      // .tsbuildinfo surviving a deleted outDir would make tsc skip re-emit.
      const incrementalArgs = isWatchBuild
        ? ['--incremental', '--tsBuildInfoFile', join(outDirPath, '.tsbuildinfo')]
        : [];
      await runTsc([tscPath, '--project', projectPath, '--outDir', outDirPath, ...incrementalArgs]);
      copyHandWrittenDeclarationFiles(resolve(cwd, 'src'), outDirPath);
    }
  };
}

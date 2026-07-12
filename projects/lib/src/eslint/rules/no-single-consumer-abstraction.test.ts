/// <reference types="node" />

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import rule from './no-single-consumer-abstraction.js';
import { FILE_CACHE_TTL_MS } from './utils.js';

/**
 * Run RuleTester assertions inline instead of registering nested Vitest
 * `describe`/`it` blocks (which are illegal inside a `test()` body). Any
 * failed case throws synchronously and fails the enclosing Vitest test.
 */
const runSynchronously = (_name: string, method: () => void): void => {
  method();
};
RuleTester.describe = runSynchronously;
RuleTester.it = runSynchronously;
RuleTester.itOnly = runSynchronously;

interface Cases {
  readonly valid: RuleTester.ValidTestCase[];
  readonly invalid: RuleTester.InvalidTestCase[];
}

let tester: RuleTester;
let rootDir: string;

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), 'no-single-consumer-abstraction-'));
  tester = new RuleTester({
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' }
    }
  });
});

afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

function createFile(relativePath: string, content: string): string {
  const filename = join(rootDir, relativePath);
  mkdirSync(filename.slice(0, filename.lastIndexOf('/')), { recursive: true });
  writeFileSync(filename, content);
  return filename;
}

function run(cases: Cases): void {
  tester.run('no-single-consumer-abstraction', rule, cases);
}

test('defines rule metadata', () => {
  expect(rule.meta?.type).toBe('problem');
  expect(rule.meta?.messages?.['single-consumer']).toBeTruthy();
  expect(rule.meta?.schema).toBeTruthy();
});

test('valid: abstract base with two implementation consumers', () => {
  const filename = createFile('src/shared/toggle-button.ts', 'export abstract class ToggleButton {}');
  createFile(
    'src/play-button/play-button.ts',
    "import { ToggleButton } from '../shared/toggle-button.js';\nexport class PlayButton extends ToggleButton {}"
  );
  createFile(
    'src/mute-button/mute-button.ts',
    "import { ToggleButton } from '../shared/toggle-button.js';\nexport class MuteButton extends ToggleButton {}"
  );

  run({
    valid: [{ filename, code: 'export abstract class ToggleButton {}', options: [{ rootDir }] }],
    invalid: []
  });
});

test('valid: counts subclasses imported via extensionless (bundler-resolution) specifiers', () => {
  const filename = createFile('src/shared/toggle-base.ts', 'export abstract class ToggleBase {}');
  createFile(
    'src/play-button/play-button.ts',
    "import { ToggleBase } from '../shared/toggle-base';\nexport class PlayButton extends ToggleBase {}"
  );
  createFile(
    'src/mute-button/mute-button.ts',
    "import { ToggleBase } from '../shared/toggle-base';\nexport class MuteButton extends ToggleBase {}"
  );

  run({
    valid: [{ filename, code: 'export abstract class ToggleBase {}', options: [{ rootDir }] }],
    invalid: []
  });
});

test('valid: counts subclasses imported via .ts-suffixed specifiers', () => {
  const filename = createFile('src/shared/toggle-base.ts', 'export abstract class ToggleBase {}');
  createFile(
    'src/play-button/play-button.ts',
    "import { ToggleBase } from '../shared/toggle-base.ts';\nexport class PlayButton extends ToggleBase {}"
  );
  createFile(
    'src/mute-button/mute-button.ts',
    "import { ToggleBase } from '../shared/toggle-base.ts';\nexport class MuteButton extends ToggleBase {}"
  );

  run({
    valid: [{ filename, code: 'export abstract class ToggleBase {}', options: [{ rootDir }] }],
    invalid: []
  });
});

test('valid: counts subclasses whose own type parameters nest angle brackets', () => {
  const filename = createFile('src/shared/store.ts', 'export abstract class Store {}');
  createFile(
    'src/a/a.ts',
    "import { Store } from '../shared/store.js';\nexport class A<T extends Record<string, unknown>> extends Store {}"
  );
  createFile(
    'src/b/b.ts',
    "import { Store } from '../shared/store.js';\nexport class B<T extends Map<string, number>> extends Store {}"
  );

  run({
    valid: [{ filename, code: 'export abstract class Store {}', options: [{ rootDir }] }],
    invalid: []
  });
});

test('valid: counts named alias and namespace import subclasses', () => {
  const filename = createFile('src/shared/toggle.ts', 'export abstract class Toggle {}');
  createFile(
    'src/play/play.ts',
    "import { Toggle as InnerToggle } from '../shared/toggle.js';\nexport class Play extends InnerToggle {}"
  );
  createFile(
    'src/mute/mute.ts',
    "import * as shared from '../shared/toggle.js';\nexport class Mute extends shared.Toggle {}"
  );

  run({
    valid: [{ filename, code: 'export abstract class Toggle {}', options: [{ rootDir }] }],
    invalid: []
  });
});

test('valid: counts default import subclasses for default-exported bases', () => {
  const filename = createFile('src/shared/toggle.ts', 'export default abstract class Toggle {}');
  createFile(
    'src/play/play.ts',
    "import InnerToggle from '../shared/toggle.js';\nexport class Play extends InnerToggle {}"
  );
  createFile(
    'src/mute/mute.ts',
    "import ToggleAlias from '../shared/toggle.js';\nexport class Mute extends ToggleAlias {}"
  );

  run({
    valid: [{ filename, code: 'export default abstract class Toggle {}', options: [{ rootDir }] }],
    invalid: []
  });
});

test('valid: base consumed through the package barrel', () => {
  const filename = createFile('src/shared/widget.ts', 'export class WidgetBase {}');
  createFile('package.json', JSON.stringify({ name: '@acme/widgets' }));
  createFile('src/index.ts', "export * from './shared/widget.js';");
  createFile(
    'src/button/button.ts',
    "import { WidgetBase } from '@acme/widgets';\nexport class Button extends WidgetBase {}"
  );
  createFile(
    'src/icon/icon.ts',
    "import { WidgetBase } from '@acme/widgets';\nexport class Icon extends WidgetBase {}"
  );

  run({
    valid: [{ filename, code: 'export class WidgetBase {}', options: [{ rootDir }] }],
    invalid: []
  });
});

test('valid: infers the package root from the filename', () => {
  const filename = createFile('src/shared/widget.ts', 'export class WidgetBase {}');
  createFile('package.json', JSON.stringify({ name: '@acme/widgets' }));
  createFile('src/index.ts', "export * from './shared/widget.js';");
  createFile(
    'src/button/button.ts',
    "import { WidgetBase } from '@acme/widgets';\nexport class Button extends WidgetBase {}"
  );
  createFile('src/tag/tag.ts', "import { WidgetBase } from '@acme/widgets';\nexport class Tag extends WidgetBase {}");

  run({
    valid: [{ filename, code: 'export class WidgetBase {}' }],
    invalid: []
  });
});

test('valid: ignores non-candidate classes', () => {
  const filename = createFile('src/shared/target-observer.ts', 'export class TargetObserver {}');

  run({
    valid: [{ filename, code: 'export class TargetObserver {}', options: [{ rootDir }] }],
    invalid: []
  });
});

test('invalid: abstract base with a single importing consumer', () => {
  const filename = createFile('src/shared/toggle.ts', 'export abstract class Toggle {}');
  createFile('src/play/play.ts', "import { Toggle } from '../shared/toggle.js';\nexport class Play extends Toggle {}");

  run({
    valid: [],
    invalid: [
      {
        filename,
        code: 'export abstract class Toggle {}',
        options: [{ rootDir }],
        errors: [{ messageId: 'single-consumer', data: { name: 'Toggle', count: '1', minimum: '2' } }]
      }
    ]
  });
});

test('invalid: ignores imports that do not subclass the base', () => {
  const filename = createFile('src/shared/toggle.ts', 'export abstract class Toggle {}');
  createFile(
    'src/shared/toggle.types.ts',
    "import type { Toggle } from './toggle.js';\nexport type ToggleLike = Toggle;"
  );
  createFile('src/play/play.ts', "import { Toggle } from '../shared/toggle.js';\nexport class Play extends Toggle {}");

  run({
    valid: [],
    invalid: [
      {
        filename,
        code: 'export abstract class Toggle {}',
        options: [{ rootDir }],
        errors: [{ messageId: 'single-consumer', data: { name: 'Toggle', count: '1', minimum: '2' } }]
      }
    ]
  });
});

test('invalid: abstract base with only a same-file subclass', () => {
  const code = 'export abstract class Toggle {}\nexport class Play extends Toggle {}';
  const filename = createFile('src/shared/toggle.ts', code);

  run({
    valid: [],
    invalid: [
      {
        filename,
        code,
        options: [{ rootDir }],
        errors: [{ messageId: 'single-consumer', data: { name: 'Toggle', count: '1', minimum: '2' } }]
      }
    ]
  });
});

test('invalid: base-named class with no consumers', () => {
  const filename = createFile('src/shared/base-overlay.ts', 'export class BaseOverlay {}');

  run({
    valid: [],
    invalid: [
      {
        filename,
        code: 'export class BaseOverlay {}',
        options: [{ rootDir }],
        errors: [{ messageId: 'single-consumer', data: { name: 'BaseOverlay', count: '0', minimum: '2' } }]
      }
    ]
  });
});

test('option namePatterns: only reports classes matching a configured pattern', () => {
  const code = 'export class WidgetCore {}';
  const filename = createFile('src/shared/widget-core.ts', code);

  run({
    valid: [{ filename, code, options: [{ rootDir }] }],
    invalid: [
      {
        filename,
        code,
        options: [{ rootDir, namePatterns: ['Core$'] }],
        errors: [{ messageId: 'single-consumer', data: { name: 'WidgetCore', count: '0', minimum: '2' } }]
      }
    ]
  });
});

test('option detectAbstract:false: stops treating abstract classes as candidates', () => {
  const code = 'export abstract class Thing {}';
  const filename = createFile('src/shared/thing.ts', code);

  run({
    valid: [{ filename, code, options: [{ rootDir, detectAbstract: false }] }],
    invalid: [
      {
        filename,
        code,
        options: [{ rootDir }],
        errors: [{ messageId: 'single-consumer', data: { name: 'Thing', count: '0', minimum: '2' } }]
      }
    ]
  });
});

test('option include: only activates on files matching the include globs', () => {
  const code = 'export class OrphanBase {}';
  const filename = createFile('src/shared/orphan-base.ts', code);

  run({
    valid: [{ filename, code, options: [{ rootDir, include: ['lib/**'] }] }],
    invalid: [
      {
        filename,
        code,
        options: [{ rootDir }],
        errors: [{ messageId: 'single-consumer', data: { name: 'OrphanBase', count: '0', minimum: '2' } }]
      }
    ]
  });
});

test('option exclude: skips files matching the exclude globs', () => {
  const code = 'export class DraftBase {}';
  const filename = createFile('src/experimental/draft-base.ts', code);

  run({
    valid: [{ filename, code, options: [{ rootDir, exclude: ['src/experimental/**'] }] }],
    invalid: [
      {
        filename,
        code,
        options: [{ rootDir }],
        errors: [{ messageId: 'single-consumer', data: { name: 'DraftBase', count: '0', minimum: '2' } }]
      }
    ]
  });
});

test('option extensions: controls which sibling files are scanned for consumers', () => {
  const code = 'export abstract class ToggleBase {}';
  const filename = createFile('src/shared/toggle-base.ts', code);
  createFile(
    'src/a/a.js',
    "import { ToggleBase } from '../shared/toggle-base.js';\nexport class AJs extends ToggleBase {}"
  );
  createFile(
    'src/b/b.js',
    "import { ToggleBase } from '../shared/toggle-base.js';\nexport class BJs extends ToggleBase {}"
  );

  run({
    valid: [{ filename, code, options: [{ rootDir }] }],
    invalid: [
      {
        filename,
        code,
        options: [{ rootDir, extensions: ['.ts'] }],
        errors: [{ messageId: 'single-consumer', data: { name: 'ToggleBase', count: '0', minimum: '2' } }]
      }
    ]
  });
});

test('valid: does not lint a file outside the package root', () => {
  const outside = join(tmpdir(), 'outside-root-base.ts');

  run({
    valid: [{ filename: outside, code: 'export abstract class Stray {}', options: [{ rootDir }] }],
    invalid: []
  });
});

test('cache: re-lists package files once FILE_CACHE_TTL_MS elapses, picking up a consumer added mid-process', () => {
  vi.useFakeTimers();
  try {
    const filename = createFile('src/shared/toggle.ts', 'export abstract class Toggle {}');
    createFile(
      'src/play/play.ts',
      "import { Toggle } from '../shared/toggle.js';\nexport class Play extends Toggle {}"
    );

    // Primes FILE_CACHE for this rootDir with only one consumer on disk.
    run({
      valid: [],
      invalid: [
        {
          filename,
          code: 'export abstract class Toggle {}',
          options: [{ rootDir }],
          errors: [{ messageId: 'single-consumer', data: { name: 'Toggle', count: '1', minimum: '2' } }]
        }
      ]
    });

    createFile(
      'src/mute/mute.ts',
      "import { Toggle } from '../shared/toggle.js';\nexport class Mute extends Toggle {}"
    );

    // Still inside the TTL window: the cached file list predates `mute.ts`.
    run({
      valid: [],
      invalid: [
        {
          filename,
          code: 'export abstract class Toggle {}',
          options: [{ rootDir }],
          errors: [{ messageId: 'single-consumer', data: { name: 'Toggle', count: '1', minimum: '2' } }]
        }
      ]
    });

    vi.setSystemTime(Date.now() + FILE_CACHE_TTL_MS + 1);

    // Past the TTL: the cache recomputes and now sees both consumers.
    run({
      valid: [{ filename, code: 'export abstract class Toggle {}', options: [{ rootDir }] }],
      invalid: []
    });
  } finally {
    vi.useRealTimers();
  }
});

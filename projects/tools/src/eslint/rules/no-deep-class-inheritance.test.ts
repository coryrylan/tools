import { expect, it } from 'vitest';
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import noDeepClassInheritance from './no-deep-class-inheritance.js';

// Deliberately avoids `node:path`/`node:url` and `import.meta.dirname`: this
// package's `@types/node` doesn't provide a global `ImportMeta.dirname`
// augmentation, and the `URL` global (from the DOM lib, not Node) is enough
// to turn this module's own URL into an absolute directory path.
const currentDirname = new URL('.', import.meta.url).pathname;

// `RuleTester#run` builds its own nested `describe`/`it` structure internally,
// so each call below is a bare statement rather than wrapped in `it(...)` -
// Vitest (unlike Mocha/node:test) rejects registering a suite from inside a
// test callback.

it('defines rule metadata', () => {
  expect(noDeepClassInheritance.meta?.type).toBe('problem');
  expect(noDeepClassInheritance.meta?.messages?.['too-deep']).toBeTruthy();
});

const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      projectService: {
        allowDefaultProject: ['*.ts'],
        // This file exercises the type-aware `ClassDeclaration` walk against
        // many small synthetic fixtures, each with its own filename - well
        // past typescript-eslint's default safety cap for the number of
        // files it will let fall back to the "default project".
        maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 20
      },
      tsconfigRootDir: currentDirname
    }
  }
});

tester.run(
  'no-deep-class-inheritance (direct and depth-2 inheritance under the default maxDepth)',
  noDeepClassInheritance,
  {
    valid: [
      {
        filename: 'direct.ts',
        code: `
        declare class Base {}

        class Widget extends Base {}
      `
      },
      {
        filename: 'depth-two.ts',
        code: `
        declare class Base {}

        class WidgetBase extends Base {}
        class Button extends WidgetBase {}
      `
      },
      {
        filename: 'ambient-root.ts',
        code: `
        class Registry extends EventTarget {}
        class ManagedRegistry extends Registry {}
      `
      }
    ],
    invalid: []
  }
);

tester.run('no-deep-class-inheritance (custom maxDepth)', noDeepClassInheritance, {
  valid: [
    {
      filename: 'custom-max-depth.ts',
      options: [{ maxDepth: 3 }],
      code: `
        declare class Base {}

        class ButtonBase extends Base {}
        class SortButton extends ButtonBase {}
        class ToolbarSortButton extends SortButton {}
      `
    }
  ],
  invalid: []
});

tester.run(
  'no-deep-class-inheritance (allowedRoots truncates the counted chain once reached)',
  noDeepClassInheritance,
  {
    valid: [
      {
        filename: 'custom-root.ts',
        options: [{ allowedRoots: ['Base'] }],
        code: `
        class Base {}
        class Control extends Base {}
        class Widget extends Control {}
      `
      },
      {
        // Without `allowedRoots`, Widget's chain (Control -> Mid -> Base) is
        // length 3 and would exceed the default maxDepth of 2 (see the
        // matching invalid case below) - allowedRoots stops the count at Mid.
        filename: 'custom-root-truncates-otherwise-too-deep-chain.ts',
        options: [{ allowedRoots: ['Mid'] }],
        code: `
        class Base {}
        class Mid extends Base {}
        class Control extends Mid {}
        class Widget extends Control {}
      `
      }
    ],
    invalid: []
  }
);

tester.run('no-deep-class-inheritance (reports classes deeper than the default maxDepth)', noDeepClassInheritance, {
  valid: [],
  invalid: [
    {
      filename: 'too-deep.ts',
      code: `
        declare class Base {}

        class ButtonBase extends Base {}
        class SortButton extends ButtonBase {}
        class ToolbarSortButton extends SortButton {}
      `,
      errors: [
        {
          messageId: 'too-deep',
          data: {
            className: 'ToolbarSortButton',
            depth: '3',
            maxDepth: '2',
            chain: 'ToolbarSortButton -> SortButton -> ButtonBase -> Base'
          }
        }
      ]
    },
    {
      // No options passed: this package's default `allowedRoots` is `[]`, so
      // a class named like a "base" is not exempted just by naming
      // convention - it still counts toward the depth like any other link.
      filename: 'default-allowed-roots-is-empty.ts',
      code: `
        class Base {}
        class Mid extends Base {}
        class Control extends Mid {}
        class Widget extends Control {}
      `,
      errors: [
        {
          messageId: 'too-deep',
          data: {
            className: 'Widget',
            depth: '3',
            maxDepth: '2',
            chain: 'Widget -> Control -> Mid -> Base'
          }
        }
      ]
    }
  ]
});

tester.run(
  'no-deep-class-inheritance (reports classes deeper than a custom maxDepth even with allowedRoots set)',
  noDeepClassInheritance,
  {
    valid: [],
    invalid: [
      {
        filename: 'custom-max-depth-invalid.ts',
        options: [{ maxDepth: 1, allowedRoots: ['Base'] }],
        code: `
        class Base {}

        class Control extends Base {}
        class Radio extends Control {}
      `,
        errors: [
          {
            messageId: 'too-deep',
            data: {
              className: 'Radio',
              depth: '2',
              maxDepth: '1',
              chain: 'Radio -> Control -> Base'
            }
          }
        ]
      }
    ]
  }
);

import { expect, it } from 'vitest';
import { RuleTester } from 'eslint';
import noReexportBarrels from './no-reexport-barrels.js';

// `RuleTester#run` builds its own nested `describe`/`it` structure internally,
// so each call below is a bare statement rather than wrapped in `it(...)` -
// Vitest (unlike Mocha/node:test) rejects registering a suite from inside a
// test callback.

it('defines rule metadata', () => {
  expect(noReexportBarrels.meta?.type).toBe('suggestion');
  expect(noReexportBarrels.meta?.messages?.['tooManyReexports']).toBeTruthy();
});

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  }
});

/** Builds `count` distinct `export * from './modN.js';` lines. */
function starExports(count: number): string {
  return Array.from({ length: count }, (_, index) => `export * from './mod${String(index)}.js';`).join('\n');
}

tester.run('no-reexport-barrels (exactly at the default threshold)', noReexportBarrels, {
  valid: [{ code: starExports(5) }],
  invalid: []
});

tester.run('no-reexport-barrels (named re-exports are ignored by default)', noReexportBarrels, {
  valid: [
    {
      code: [
        "export { a } from './a.js';",
        "export { b } from './b.js';",
        "export { c } from './c.js';",
        "export { d } from './d.js';",
        "export { e } from './e.js';",
        "export { f } from './f.js';"
      ].join('\n')
    },
    // Plain re-exports (no source) never count, regardless of options.
    { code: 'const a = 1; const b = 2;\nexport { a, b };' },
    // Local declarations never count.
    { code: 'export const value = 1;\nexport function run() {}\nexport class Thing {}' }
  ],
  invalid: []
});

tester.run('no-reexport-barrels (6 export * from modules reports 6 errors)', noReexportBarrels, {
  valid: [],
  invalid: [
    {
      code: starExports(6),
      errors: Array.from({ length: 6 }, () => ({ messageId: 'tooManyReexports', data: { count: 6, max: 5 } }))
    }
  ]
});

tester.run('no-reexport-barrels (export * as ns counts the same as export * from)', noReexportBarrels, {
  valid: [],
  invalid: [
    {
      code: [
        "export * as a from './a.js';",
        "export * as b from './b.js';",
        "export * as c from './c.js';",
        "export * as d from './d.js';",
        "export * as e from './e.js';",
        "export * as f from './f.js';"
      ].join('\n'),
      errors: Array.from({ length: 6 }, () => ({ messageId: 'tooManyReexports', data: { count: 6, max: 5 } }))
    }
  ]
});

tester.run('no-reexport-barrels (allowNamed: false counts named re-exports with a source)', noReexportBarrels, {
  valid: [],
  invalid: [
    {
      code: [
        "export * from './a.js';",
        "export * from './b.js';",
        "export * from './c.js';",
        "export { d } from './d.js';",
        "export { e } from './e.js';",
        "export { f } from './f.js';"
      ].join('\n'),
      options: [{ allowNamed: false }],
      errors: Array.from({ length: 6 }, () => ({ messageId: 'tooManyReexports', data: { count: 6, max: 5 } }))
    }
  ]
});

tester.run(
  'no-reexport-barrels (mixed export * and allowed named re-exports, over a custom maxReexports)',
  noReexportBarrels,
  {
    valid: [],
    invalid: [
      {
        code: [
          "export * from './a.js';",
          "export * from './b.js';",
          "export * from './c.js';",
          // Named re-export without allowNamed: false does not count, so it
          // is not part of the 3 flagged nodes even though the file has 4
          // export-with-source statements in total.
          "export { d } from './d.js';"
        ].join('\n'),
        options: [{ maxReexports: 2 }],
        errors: Array.from({ length: 3 }, () => ({ messageId: 'tooManyReexports', data: { count: 3, max: 2 } }))
      }
    ]
  }
);

tester.run('no-reexport-barrels (maxReexports: 0 flags a single export * from)', noReexportBarrels, {
  valid: [],
  invalid: [
    {
      code: "export * from './a.js';",
      options: [{ maxReexports: 0 }],
      errors: [{ messageId: 'tooManyReexports', data: { count: 1, max: 0 } }]
    }
  ]
});

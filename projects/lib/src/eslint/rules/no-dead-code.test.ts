import { expect, it } from 'vitest';
import { RuleTester } from 'eslint';
import noDeadCode from './no-dead-code.js';

// `RuleTester#run` builds its own nested `describe`/`it` structure internally,
// so each call below is a bare statement rather than wrapped in `it(...)` -
// Vitest (unlike Mocha/node:test) rejects registering a suite from inside a
// test callback.

it('defines rule metadata', () => {
  expect(noDeadCode.meta?.type).toBe('problem');
  expect(noDeadCode.meta?.messages?.['unexpected-dead-code']).toBeTruthy();
});

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  }
});

tester.run('no-dead-code (prose and JSDoc comments)', noDeadCode, {
  valid: [
    {
      code: `
        // This helper normalizes whitespace before comparing strings.
        function normalize(value) {
          return value.trim();
        }
      `
    },
    {
      code: `
        /**
         * Fetches the user's profile.
         * @param {string} id - The user id.
         */
        function getProfile(id) {
          return fetch(id);
        }
      `
    },
    {
      code: '// TODO: revisit this once the API stabilizes'
    },
    // Backtick-quoted mentions of code constructs are documentation, not
    // commented-out code - a very common pattern in this codebase's own test
    // files (explaining why `RuleTester.run()` can't be nested inside `it()`).
    {
      code: '// so each call below is a bare statement rather than wrapped in `it(...)` here'
    },
    {
      code: "/** Builds `count` distinct `export * from './modN.js';` lines. */"
    },
    // A prose sentence that happens to word-wrap onto a line ending in a
    // control-flow keyword ("for", "if", "do", ...) is not a lone dangling
    // keyword from commented-out code.
    {
      code: '// "catalog:" isn\'t a ^/~ range, so it still counts as "pinned" for'
    }
  ],
  invalid: []
});

tester.run('no-dead-code (ESLint directive comments are never flagged, even if code-shaped)', noDeadCode, {
  valid: [
    { code: '// eslint-disable-next-line no-console -- console.log(foo);' },
    { code: '// eslint-disable no-console' },
    { code: '/* eslint-enable no-console */' },
    // Note: `/* eslint-env */` itself can no longer appear in a RuleTester
    // case at all - ESLint 9+ treats it as a fatal parse-time error before
    // any rule runs. The `eslint-env` prefix stays in `DIRECTIVE_COMMENT_PATTERN`
    // regardless, since old codebases linted with an older ESLint/parser can
    // still carry the comment, and it must never be reported as dead code.
    { code: '/* global foo, bar */' },
    { code: '/* globals foo, bar */' },
    { code: '/* exported foo */' }
  ],
  invalid: []
});

tester.run('no-dead-code (TypeScript pragma, Prettier, and coverage marker comments are never flagged)', noDeadCode, {
  valid: [
    { code: '// @ts-ignore return foo();' },
    { code: '// @ts-expect-error const x = 1;' },
    { code: '// @ts-nocheck' },
    { code: '// prettier-ignore' },
    { code: '// c8 ignore next' },
    { code: '/* c8 ignore start */' },
    { code: '// istanbul ignore next' },
    { code: '/* istanbul ignore else */' }
  ],
  invalid: []
});

tester.run('no-dead-code (allowPatterns exempts matching comments)', noDeadCode, {
  valid: [
    {
      options: [{ allowPatterns: ['^TODO:'] }],
      code: '// TODO: const draft = buildDraft();'
    },
    {
      options: [{ allowPatterns: ['^example:'] }],
      code: '// example: if (ready) { start(); }'
    }
  ],
  invalid: []
});

tester.run('no-dead-code (commented-out import/export statements)', noDeadCode, {
  valid: [],
  invalid: [
    {
      code: "// import { helper } from './helper.js';",
      errors: [{ messageId: 'unexpected-dead-code', data: { type: 'line' } }]
    },
    {
      code: "// export { helper } from './helper.js';",
      errors: [{ messageId: 'unexpected-dead-code', data: { type: 'line' } }]
    }
  ]
});

tester.run('no-dead-code (commented-out function and arrow function declarations)', noDeadCode, {
  valid: [],
  invalid: [
    {
      code: '// function computeTotal(items) { return items.length; }',
      errors: [{ messageId: 'unexpected-dead-code' }]
    },
    {
      code: '/* const computeTotal = items => items.length; */',
      errors: [{ messageId: 'unexpected-dead-code', data: { type: 'block' } }]
    }
  ]
});

tester.run('no-dead-code (commented-out variable declarations and control flow)', noDeadCode, {
  valid: [],
  invalid: [
    {
      code: '// const total = 0;',
      errors: [{ messageId: 'unexpected-dead-code' }]
    },
    {
      code: '// if (ready) { start(); }',
      errors: [{ messageId: 'unexpected-dead-code' }]
    },
    // A bare control-flow keyword with nothing else in the comment is still
    // flagged - only a keyword ending a longer prose sentence is exempt.
    {
      code: '// for',
      errors: [{ messageId: 'unexpected-dead-code' }]
    }
  ]
});

tester.run('no-dead-code (commented-out return, console.log, and debugger statements)', noDeadCode, {
  valid: [],
  invalid: [
    {
      code: '// return total;',
      errors: [{ messageId: 'unexpected-dead-code' }]
    },
    {
      code: '// console.log(total);',
      errors: [{ messageId: 'unexpected-dead-code' }]
    },
    {
      code: '// debugger;',
      errors: [{ messageId: 'unexpected-dead-code' }]
    }
  ]
});

tester.run('no-dead-code (commented-out test scaffolding)', noDeadCode, {
  valid: [],
  invalid: [
    {
      code: "// describe('total', () => {});",
      errors: [{ messageId: 'unexpected-dead-code' }]
    },
    {
      code: "// it('adds up', () => {});",
      errors: [{ messageId: 'unexpected-dead-code' }]
    }
  ]
});

tester.run('no-dead-code (allowPatterns only exempts comments that match)', noDeadCode, {
  valid: [],
  invalid: [
    {
      options: [{ allowPatterns: ['^TODO:'] }],
      code: '// const draft = buildDraft();',
      errors: [{ messageId: 'unexpected-dead-code' }]
    }
  ]
});

tester.run('no-dead-code (arrow-function heuristic requires code context, not just a bare arrow)', noDeadCode, {
  valid: [
    // Prose that uses "=>" as a mapping/notation arrow, not an arrow
    // function - no parens, call, or assignment around it.
    {
      code: '// maps rule id => enabling config name'
    },
    {
      code: '// fallback chain: attr => property => default'
    }
  ],
  invalid: [
    {
      code: '// const add = (a, b) => a + b;',
      errors: [{ messageId: 'unexpected-dead-code' }]
    },
    {
      code: '// items.map(item => item.id)',
      errors: [{ messageId: 'unexpected-dead-code' }]
    },
    {
      code: '// const handler = x => ({ id: x });',
      errors: [{ messageId: 'unexpected-dead-code' }]
    }
  ]
});

tester.run('no-dead-code (a malformed allowPatterns entry is skipped, not thrown)', noDeadCode, {
  valid: [
    // The malformed pattern fails to compile and is skipped; the
    // well-formed sibling pattern still exempts the comment it matches.
    {
      options: [{ allowPatterns: ['[test', '^TODO:'] }],
      code: '// TODO: const draft = buildDraft();'
    }
  ],
  invalid: [
    // The only supplied pattern is malformed and skipped (and wouldn't
    // have matched this comment's text anyway), so the lint run completes
    // instead of crashing, and this comment is still flagged.
    {
      options: [{ allowPatterns: ['[test'] }],
      code: '// const draft = buildDraft();',
      errors: [{ messageId: 'unexpected-dead-code' }]
    }
  ]
});

import { expect, it } from 'vitest';
import { RuleTester } from 'eslint';
import noExcessiveComments from './no-excessive-comments.js';

it('defines rule metadata', () => {
  expect(noExcessiveComments.meta?.type).toBe('suggestion');
  expect(noExcessiveComments.meta?.messages?.['excessive-prose']).toBeTruthy();
});

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  }
});

// max:40 keeps snippets small; the prose being budgeted is what's over or under that.
tester.run('no-excessive-comments (short prose is under budget)', noExcessiveComments, {
  valid: [
    {
      code: '/** Adds two numbers. */\nexport function add(a, b) { return a + b; }',
      options: [{ max: 40 }]
    },
    // structural tags only - types and param names are not counted
    {
      code: '/**\n * @param a addend\n * @param b addend\n * @returns sum\n */\nexport function add(a, b) { return a + b; }',
      options: [{ max: 40 }]
    },
    // a long @example is code, not prose - ignored
    {
      code: '/**\n * Adds.\n * @example\n * const t = add(1, 2) + add(3, 4) + add(5, 6) + add(7, 8);\n */\nexport function add(a, b) { return a + b; }',
      options: [{ max: 40 }]
    },
    // non-JSDoc block and line comments are out of scope for this rule
    {
      code: '/* a long free-floating block comment that just rambles on and on and on here */\nconst x = 1;',
      options: [{ max: 40 }]
    },
    {
      code: '// a long line comment this rule does not concern itself with at all really\nconst x = 1;',
      options: [{ max: 40 }]
    }
  ],
  invalid: []
});

tester.run('no-excessive-comments (over-budget prose is flagged, including tag loopholes)', noExcessiveComments, {
  valid: [],
  invalid: [
    {
      code: '/** This adds two numbers and also does a bunch of other stuff nobody bothers to document. */\nexport function add(a, b) { return a + b; }',
      options: [{ max: 40 }],
      errors: [{ messageId: 'excessive-prose' }]
    },
    // sidestep via @description
    {
      code: '/**\n * Adds.\n * @description The agent explains the entire history of arithmetic right here in prose.\n */\nexport function add(a, b) { return a + b; }',
      options: [{ max: 40 }],
      errors: [{ messageId: 'excessive-prose' }]
    },
    // sidestep via @summary
    {
      code: '/**\n * @summary A summary that is far too long and clearly a place to hide a wall of text.\n */\nexport function add(a, b) { return a + b; }',
      options: [{ max: 40 }],
      errors: [{ messageId: 'excessive-prose' }]
    },
    // sidestep via @param description (loophole closed - the name drops, the description counts)
    {
      code: '/**\n * @param a this param description is abused to smuggle in a long explanation instead here\n */\nexport function add(a, b) { return a + b; }',
      options: [{ max: 40 }],
      errors: [{ messageId: 'excessive-prose' }]
    },
    // split across summary + description so no single line looks huge, but the total exceeds
    {
      code: '/**\n * @summary Half of the rambling goes here in the summary.\n * @description And the other half of the rambling continues down here.\n */\nexport function add(a, b) { return a + b; }',
      options: [{ max: 40 }],
      errors: [{ messageId: 'excessive-prose' }]
    }
  ]
});

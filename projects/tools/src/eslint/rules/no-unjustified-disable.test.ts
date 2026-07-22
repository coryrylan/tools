import { expect, it } from 'vitest';
import { RuleTester } from 'eslint';
import noUnjustifiedDisable from './no-unjustified-disable.js';

// `RuleTester#run` builds its own nested `describe`/`it` structure internally,
// so each call below is a bare statement rather than wrapped in `it(...)` -
// Vitest (unlike Mocha/node:test) rejects registering a suite from inside a
// test callback.

it('defines rule metadata', () => {
  expect(noUnjustifiedDisable.meta?.type).toBe('suggestion');
  expect(noUnjustifiedDisable.meta?.messages?.['missingJustification']).toBeTruthy();
  expect(noUnjustifiedDisable.meta?.messages?.['missingRuleIds']).toBeTruthy();
});

/**
 * RuleTester's linter treats disable comments as real directives; fixtures
 * use real rule ids to avoid a spurious "rule not found" message. Blanket
 * disables suppress our report, so those cases set
 * `noInlineConfig: true`, adding a deterministic warning.
 */
const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  },
  linterOptions: {
    reportUnusedDisableDirectives: 'off'
  }
});

/** The deterministic warning ESLint emits for a directive comment when `noInlineConfig` is on. */
function noInlineConfigWarning(commentText: string): { message: string } {
  return { message: `'${commentText}' has no effect because you have 'noInlineConfig' setting in your config.` };
}

// `RuleTester`'s per-test-case types (`ValidTestCase`/`InvalidTestCase`)
// deliberately omit `linterOptions` even though RuleTester accepts it fine
// at runtime (verified above), so a case-level override doesn't type-check.
// The constructor-level config type isn't restricted the same way, so the
// two blanket-disable cases below get their own tester instance instead.
const noInlineConfigTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  },
  linterOptions: {
    noInlineConfig: true,
    reportUnusedDisableDirectives: 'off'
  }
});

tester.run(
  'no-unjustified-disable (next-line/line directives with rule ids and a justification)',
  noUnjustifiedDisable,
  {
    valid: [
      { code: '// eslint-disable-next-line no-console -- flaky upstream types\nconsole.log(1);' },
      { code: 'console.log(1); // eslint-disable-line no-console -- flaky upstream types' },
      { code: '/* eslint-disable-next-line no-console -- flaky upstream types */\nconsole.log(1);' },
      // Comma-separated rule list before the separator is still "has a rule id".
      { code: '// eslint-disable-next-line no-console, no-unused-vars -- reason\nconsole.log(1);' },
      // Only the *first* ` -- ` is the separator; a second one is part of the justification.
      { code: '// eslint-disable-next-line no-console -- see issue -- still flaky\nconsole.log(1);' }
    ],
    invalid: []
  }
);

tester.run('no-unjustified-disable (eslint-enable and non-directive comments are ignored)', noUnjustifiedDisable, {
  valid: [
    { code: '/* eslint-enable */' },
    { code: '/* eslint-enable no-console */' },
    // Starts with "we", not the directive keyword, so it is prose, not a directive.
    { code: '// we should eslint-disable this someday' }
  ],
  invalid: []
});

tester.run('no-unjustified-disable (requireRuleIds: false allows a justified blanket disable)', noUnjustifiedDisable, {
  valid: [{ code: '/* eslint-disable -- migration */', options: [{ requireRuleIds: false }] }],
  invalid: []
});

tester.run(
  'no-unjustified-disable (missing justification on a next-line/line directive with rule ids)',
  noUnjustifiedDisable,
  {
    valid: [],
    invalid: [
      {
        code: '// eslint-disable-next-line no-console\nconsole.log(1);',
        errors: [{ messageId: 'missingJustification' }]
      },
      {
        code: 'console.log(1); // eslint-disable-line no-console',
        errors: [{ messageId: 'missingJustification' }]
      },
      {
        code: '/* eslint-disable-next-line no-console */\nconsole.log(1);',
        errors: [{ messageId: 'missingJustification' }]
      }
    ]
  }
);

tester.run('no-unjustified-disable (separator with nothing, or only whitespace, after it)', noUnjustifiedDisable, {
  valid: [],
  invalid: [
    {
      // A trailing space after `--` is required for ESLint's own directive
      // parser to recognize it as the description separator (rather than
      // folding the dashes into a malformed rule id) - our rule doesn't
      // need that space, but the fixture does, so ESLint's own directive
      // processing doesn't add an unrelated "rule not found" message.
      code: '// eslint-disable-next-line no-console -- \nconsole.log(1);',
      errors: [{ messageId: 'missingJustification' }]
    },
    {
      code: '// eslint-disable-next-line no-console --   \nconsole.log(1);',
      errors: [{ messageId: 'missingJustification' }]
    }
  ]
});

noInlineConfigTester.run(
  'no-unjustified-disable (blanket disable is missing both a justification and rule ids)',
  noUnjustifiedDisable,
  {
    valid: [],
    invalid: [
      {
        code: '/* eslint-disable */',
        // See the file preamble: this tester neutralizes the directive so our
        // report survives, at the cost of the deterministic "has no effect"
        // warning below.
        errors: [
          noInlineConfigWarning('/* eslint-disable */'),
          { messageId: 'missingJustification' },
          { messageId: 'missingRuleIds' }
        ]
      }
    ]
  }
);

noInlineConfigTester.run(
  'no-unjustified-disable (blanket disable with a justification is still missing rule ids)',
  noUnjustifiedDisable,
  {
    valid: [],
    invalid: [
      {
        code: '/* eslint-disable -- migration */',
        errors: [noInlineConfigWarning('/* eslint-disable -- migration */'), { messageId: 'missingRuleIds' }]
      }
    ]
  }
);

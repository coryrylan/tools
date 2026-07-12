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
 * ## Why this file needs a second preamble
 *
 * `no-unjustified-disable` reports on `eslint-disable*` directive *comments*
 * themselves - but ESLint's own linter also interprets those same comments
 * as real directives before RuleTester ever sees the resulting messages. Two
 * of ESLint's built-in behaviors interact with our fixtures and had to be
 * worked around deliberately (verified empirically against this exact
 * ESLint version, not assumed):
 *
 * 1. **Unknown rule ids.** If a fixture disables a rule id that isn't a real,
 *    loaded rule (e.g. the placeholder `foo` used in the rule's own spec
 *    prose), ESLint adds a hard "Definition for rule 'foo' was not found"
 *    error to the message list - for *both* valid and invalid cases - which
 *    breaks RuleTester's message-count assertions. Fix: fixtures use real
 *    core rule ids (`no-console`, `no-unused-vars`) instead of placeholders.
 *
 * 2. **A bare, blanket `eslint-disable` (no rule list) suppresses our own
 *    report.** Such a directive disables *every* rule from that point in the
 *    file onward, including this custom rule, at the exact location where
 *    we'd report - so by default RuleTester would see zero messages for a
 *    blanket-disable fixture, not our rule's messages. Confirmed via a
 *    minimal repro rule using `Linter#verify` directly: a blanket disable
 *    comment with no other code produces an empty message array even though
 *    the rule always reports once per comment.
 *
 *    Fix: the specific invalid cases that use a *blanket* disable (no rule
 *    list) set `linterOptions: { noInlineConfig: true }` on that test case.
 *    This makes ESLint skip applying the directive entirely - so our rule's
 *    messages survive - while our rule still sees the comment normally via
 *    `sourceCode.getAllComments()` (comments are unaffected by
 *    `noInlineConfig`, only their effect on suppression is). The trade-off:
 *    ESLint adds one deterministic warning message per directive comment,
 *    `'<comment text>' has no effect because you have 'noInlineConfig'
 *    setting in your config.`, which every such case must list alongside our
 *    rule's own messageIds (see `noInlineConfigWarning` below).
 *
 *    Non-blanket directives (`eslint-disable-line`/`eslint-disable-next-line`
 *    naming a specific real rule) do *not* need this workaround: they only
 *    suppress the named rule, never a differently-named custom rule, so our
 *    report is never touched - verified the same way.
 *
 * Both instance-level `reportUnusedDisableDirectives: 'off'` is also set,
 * since most fixtures intentionally "disable" a rule that never actually
 * fires on that line (we only care about the directive comment's shape, not
 * about it suppressing anything real) - without this, ESLint adds its own
 * "Unused eslint-disable directive" warning to every such case too.
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

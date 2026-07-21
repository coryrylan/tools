import { expect, it } from 'vitest';
import { RuleTester } from 'eslint';
import consistentErrorMessages from './consistent-error-messages.js';

// `RuleTester#run` builds its own nested `describe`/`it` structure internally,
// so each call below is a bare statement rather than wrapped in `it(...)` -
// Vitest (unlike Mocha/node:test) rejects registering a suite from inside a
// test callback.

it('defines rule metadata', () => {
  const meta = consistentErrorMessages.meta;
  expect(meta?.type).toBe('problem');
  const messages = meta?.messages;
  expect(messages?.['missingMessage']).toBeTruthy();
  expect(messages?.['emptyMessage']).toBeTruthy();
  expect(messages?.['lowercaseMessage']).toBeTruthy();
  expect(messages?.['noiseMessage']).toBeTruthy();
});

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  }
});

tester.run('consistent-error-messages (well-formed messages across constructors and forms)', consistentErrorMessages, {
  valid: [
    { code: "new Error('Cannot open config file');" },
    { code: 'new Error(`${path} not found`);' },
    { code: "new TypeError('Expected a string');" },
    { code: "new ValidationError('Missing field: name');" }
  ],
  invalid: []
});

tester.run(
  'consistent-error-messages (non-analyzable first arguments and excluded constructors are skipped)',
  consistentErrorMessages,
  {
    valid: [
      { code: 'new Error(msg);' },
      { code: 'new Error(getMessage());' },
      { code: 'new Error(ok ? a : b);' },
      { code: 'new Error(obj.message);' },
      // AggregateError's message is the 2nd argument; explicitly out of scope.
      { code: "new AggregateError([], 'oops');" }
    ],
    invalid: []
  }
);

tester.run('consistent-error-messages (missing message: no arguments)', consistentErrorMessages, {
  valid: [],
  invalid: [
    { code: 'new Error();', errors: [{ messageId: 'missingMessage' }] },
    { code: 'new TypeError();', errors: [{ messageId: 'missingMessage' }] }
  ]
});

tester.run('consistent-error-messages (empty message: blank or whitespace-only)', consistentErrorMessages, {
  valid: [],
  invalid: [
    { code: "new Error('');", errors: [{ messageId: 'emptyMessage' }] },
    { code: "new Error('   ');", errors: [{ messageId: 'emptyMessage' }] },
    { code: 'new Error(``);', errors: [{ messageId: 'emptyMessage' }] }
  ]
});

tester.run(
  'consistent-error-messages (noise messages, case-insensitive against the default denylist)',
  consistentErrorMessages,
  {
    valid: [],
    invalid: [
      { code: "new Error('error');", errors: [{ messageId: 'noiseMessage', data: { text: 'error' } }] },
      { code: "new Error('FAILED');", errors: [{ messageId: 'noiseMessage', data: { text: 'FAILED' } }] },
      {
        code: "new Error('Something went wrong');",
        errors: [{ messageId: 'noiseMessage', data: { text: 'Something went wrong' } }]
      },
      // Call form (no `new`) is analyzed identically to the `new` form.
      { code: "Error('bad');", errors: [{ messageId: 'noiseMessage', data: { text: 'bad' } }] }
    ]
  }
);

tester.run(
  'consistent-error-messages (lowercase-leading messages that are not noise and not empty)',
  consistentErrorMessages,
  {
    valid: [],
    invalid: [
      { code: "new Error('could not open file');", errors: [{ messageId: 'lowercaseMessage' }] },
      { code: 'new Error(`failed: ${path}`);', errors: [{ messageId: 'lowercaseMessage' }] }
    ]
  }
);

tester.run('consistent-error-messages (template literal edge cases)', consistentErrorMessages, {
  valid: [
    // Starts with an interpolation, so it's treated as informative regardless of content.
    { code: 'new Error(`${code}`);' }
  ],
  invalid: [
    // Empty first quasi with no expressions at all is just an empty message.
    { code: 'new Error(``);', errors: [{ messageId: 'emptyMessage' }] }
  ]
});

tester.run(
  'consistent-error-messages (allowLowercase permits a lowercase start but still flags noise/empty)',
  consistentErrorMessages,
  {
    valid: [{ code: "new Error('could not open file');", options: [{ allowLowercase: true }] }],
    invalid: [
      { code: "new Error('');", options: [{ allowLowercase: true }], errors: [{ messageId: 'emptyMessage' }] },
      {
        code: "new Error('failed');",
        options: [{ allowLowercase: true }],
        errors: [{ messageId: 'noiseMessage', data: { text: 'failed' } }]
      }
    ]
  }
);

tester.run(
  'consistent-error-messages (non-constructor helpers whose name ends in "Error" are not error constructors)',
  consistentErrorMessages,
  {
    valid: [
      // `reportError` is a real global function that takes an error/message;
      // lowercase-first names are not constructors and must not be flagged.
      { code: "reportError('failed');" },
      { code: "logError('oops');" },
      { code: "handleError('');" },
      { code: "onError('error');" }
    ],
    invalid: [
      // A PascalCase custom error class is still checked.
      {
        code: "new ValidationError('failed');",
        errors: [{ messageId: 'noiseMessage', data: { text: 'failed' } }]
      }
    ]
  }
);

tester.run(
  'consistent-error-messages (a custom disallow list replaces, not extends, the defaults)',
  consistentErrorMessages,
  {
    valid: [
      // 'error' is only noise by default; a custom list drops it. Capitalized
      // so this case isolates the disallow-list behavior from the separate
      // lowercase-start check.
      { code: "new Error('Error');", options: [{ disallow: ['nope'] }] }
    ],
    invalid: [
      {
        code: "new Error('nope');",
        options: [{ disallow: ['nope'] }],
        errors: [{ messageId: 'noiseMessage', data: { text: 'nope' } }]
      }
    ]
  }
);

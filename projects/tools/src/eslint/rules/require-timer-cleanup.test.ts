import { describe, expect, it } from 'vitest';
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import requireTimerCleanup from './require-timer-cleanup.js';

// `RuleTester.run()` detects Vitest's global `describe`/`it` (from `globals: true`
// in vitest.config.ts) and uses them to register its own nested suites, so every
// `tester.run(...)` call below must sit at the top level of the module - nesting
// it inside one of our own `it()` callbacks throws "Calling the suite function
// inside test function is not allowed."
const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module'
    }
  }
});

describe('require-timer-cleanup', () => {
  it('defines rule metadata', () => {
    expect(requireTimerCleanup.meta?.type).toBe('problem');
    expect(requireTimerCleanup.meta?.messages?.['unstoppable-interval']).toBeTruthy();
    expect(requireTimerCleanup.meta?.messages?.['missing-timer-cleanup']).toBeTruthy();
  });
});

tester.run('valid: setInterval stored and cleared', requireTimerCleanup, {
  valid: [
    {
      code: `
        class Foo {
          #intervalId;
          connectedCallback() {
            this.#intervalId = setInterval(() => {}, 100);
          }
          disconnectedCallback() {
            clearInterval(this.#intervalId);
          }
        }
      `
    },
    {
      code: `
        class Foo {
          #intervalId = setInterval(() => {}, 100);
          disconnectedCallback() {
            clearInterval(this.#intervalId);
          }
        }
      `
    },
    {
      code: `
        class Foo {
          connectedCallback() {
            this.timeoutId = setTimeout(() => {}, 100);
          }
          disconnectedCallback() {
            clearTimeout(this.timeoutId);
          }
        }
      `
    },
    {
      code: `
        class Foo {
          connectedCallback() {
            this.#id = globalThis.setTimeout(() => {}, 100);
          }
          disconnectedCallback() {
            globalThis.clearTimeout(this.#id);
          }
        }
      `
    }
  ],
  invalid: []
});

tester.run('valid: unstored setTimeout one-shot', requireTimerCleanup, {
  valid: [
    {
      code: `
        class Foo {
          connectedCallback() {
            setTimeout(() => this.doSomething(), 0);
          }
        }
      `
    },
    {
      code: `
        class Foo {
          connectedCallback() {
            const id = setTimeout(() => this.doSomething(), 100);
          }
        }
      `
    }
  ],
  invalid: []
});

tester.run('valid: timers at module scope are not this rule', requireTimerCleanup, {
  valid: [
    {
      code: `
        setInterval(() => {}, 100);
        setTimeout(() => {}, 100);
      `
    }
  ],
  invalid: []
});

tester.run('invalid: setInterval with no stored handle inside a class', requireTimerCleanup, {
  valid: [],
  invalid: [
    {
      code: `
        class Foo {
          connectedCallback() {
            setInterval(() => {}, 100);
          }
        }
      `,
      errors: [{ messageId: 'unstoppable-interval' }]
    }
  ]
});

tester.run('invalid: stored setInterval without clearInterval', requireTimerCleanup, {
  valid: [],
  invalid: [
    {
      code: `
        class Foo {
          connectedCallback() {
            this.#id = setInterval(() => {}, 100);
          }
          disconnectedCallback() {}
        }
      `,
      errors: [
        {
          messageId: 'missing-timer-cleanup',
          data: { fn: 'setInterval', target: 'this.#id', clear: 'clearInterval' }
        }
      ]
    }
  ]
});

tester.run('invalid: stored setTimeout without clearTimeout', requireTimerCleanup, {
  valid: [],
  invalid: [
    {
      code: `
        class Foo {
          connectedCallback() {
            this.#id = setTimeout(() => {}, 1000);
          }
        }
      `,
      errors: [
        {
          messageId: 'missing-timer-cleanup',
          data: { fn: 'setTimeout', target: 'this.#id', clear: 'clearTimeout' }
        }
      ]
    }
  ]
});

tester.run('valid: setInterval stored in a local variable is not flagged', requireTimerCleanup, {
  valid: [
    {
      code: `
        class Foo {
          connectedCallback() {
            const id = setInterval(() => {}, 100);
            clearInterval(id);
          }
        }
      `
    }
  ],
  invalid: []
});

tester.run('invalid: globalThis.setInterval stored without clearInterval', requireTimerCleanup, {
  valid: [],
  invalid: [
    {
      code: `
        class Foo {
          connectedCallback() {
            this.#id = globalThis.setInterval(() => {}, 100);
          }
        }
      `,
      errors: [
        {
          messageId: 'missing-timer-cleanup',
          data: { fn: 'setInterval', target: 'this.#id', clear: 'clearInterval' }
        }
      ]
    }
  ]
});

tester.run('invalid: stored setInterval cleared with wrong handle text', requireTimerCleanup, {
  valid: [],
  invalid: [
    {
      code: `
        class Foo {
          connectedCallback() {
            this.#id = setInterval(() => {}, 100);
          }
          disconnectedCallback() {
            clearInterval(this.otherId);
          }
        }
      `,
      errors: [
        {
          messageId: 'missing-timer-cleanup',
          data: { fn: 'setInterval', target: 'this.#id', clear: 'clearInterval' }
        }
      ]
    }
  ]
});

tester.run('invalid: setInterval stored in a local variable that is never cleared or handed off', requireTimerCleanup, {
  valid: [],
  invalid: [
    {
      code: `
        class Foo {
          start() {
            const id = setInterval(() => this.poll(), 1000);
          }
        }
      `,
      errors: [{ messageId: 'unstoppable-interval' }]
    }
  ]
});

tester.run(
  'valid: setInterval stored in a local variable and self-cleared from its own callback',
  requireTimerCleanup,
  {
    valid: [
      {
        code: `
        class Foo {
          start() {
            const id = setInterval(() => {
              if (this.done) {
                clearInterval(id);
              }
            }, 1000);
          }
        }
      `
      }
    ],
    invalid: []
  }
);

tester.run('valid: setInterval handle returned directly escapes the rule', requireTimerCleanup, {
  valid: [
    {
      code: `
        class Foo {
          start() {
            return setInterval(() => this.poll(), 1000);
          }
        }
      `
    },
    {
      code: `
        class Foo {
          start() {
            const id = setInterval(() => this.poll(), 1000);
            return id;
          }
        }
      `
    }
  ],
  invalid: []
});

tester.run('valid: local setInterval handle assigned onward to a this-member escapes the rule', requireTimerCleanup, {
  valid: [
    {
      code: `
        class Foo {
          #timer;
          start() {
            const id = setInterval(() => this.poll(), 1000);
            this.#timer = id;
          }
        }
      `
    }
  ],
  invalid: []
});

tester.run('valid: local setInterval handle passed to an external owner escapes the rule', requireTimerCleanup, {
  valid: [
    {
      code: `
        class Foo {
          start() {
            const id = setInterval(() => this.poll(), 1000);
            registry.track(id);
          }
        }
      `
    }
  ],
  invalid: []
});

import { describe, expect, it } from 'vitest';
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import requireObserverCleanup from './require-observer-cleanup.js';

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

describe('require-observer-cleanup', () => {
  it('defines rule metadata', () => {
    expect(requireObserverCleanup.meta?.type).toBe('problem');
    expect(requireObserverCleanup.meta?.messages?.['inline-observer-leak']).toBeTruthy();
  });
});

tester.run('valid: observer stored on a class field', requireObserverCleanup, {
  valid: [
    {
      code: `
        class Foo {
          #ro;
          connectedCallback() {
            this.#ro = new ResizeObserver(() => {});
            this.#ro.observe(this);
          }
          disconnectedCallback() {
            this.#ro.disconnect();
          }
        }
      `
    },
    {
      code: `
        class Foo {
          #ro = new ResizeObserver(() => {});
        }
      `
    },
    {
      code: `
        class Foo {
          connectedCallback() {
            const obs = new MutationObserver(() => {});
            obs.observe(this);
            this.observers.push(obs);
          }
        }
      `
    },
    {
      code: `
        class Foo {
          connectedCallback() {
            this.observers.push(new IntersectionObserver(() => {}));
          }
        }
      `
    },
    {
      code: `
        class Foo {
          createObserver() {
            return new PerformanceObserver(() => {});
          }
        }
      `
    }
  ],
  invalid: []
});

tester.run('valid: observer created at module scope is not this rule', requireObserverCleanup, {
  valid: [
    {
      code: `
        const ro = new ResizeObserver(() => {});
        ro.observe(document.body);
      `
    },
    {
      code: `
        new ResizeObserver(() => {}).observe(document.body);
      `
    }
  ],
  invalid: []
});

tester.run('invalid: inline observer with chained observe()', requireObserverCleanup, {
  valid: [],
  invalid: [
    {
      code: `
        class Foo {
          connectedCallback() {
            new ResizeObserver(() => {}).observe(this);
          }
        }
      `,
      errors: [{ messageId: 'inline-observer-leak', data: { kind: 'ResizeObserver' } }]
    },
    {
      code: `
        class Foo {
          connectedCallback() {
            new MutationObserver(() => {}).observe(this, { childList: true });
          }
        }
      `,
      errors: [{ messageId: 'inline-observer-leak', data: { kind: 'MutationObserver' } }]
    }
  ]
});

tester.run('invalid: assignment target is the observer method chain, not the observer itself', requireObserverCleanup, {
  valid: [],
  invalid: [
    {
      // `new ResizeObserver(fn).observe(this)` evaluates to `undefined` and
      // assigns undefined to #ro - the observer itself is never stored.
      code: `
        class Foo {
          #ro;
          connectedCallback() {
            this.#ro = new ResizeObserver(() => {}).observe(this);
          }
        }
      `,
      errors: [{ messageId: 'inline-observer-leak', data: { kind: 'ResizeObserver' } }]
    }
  ]
});

tester.run('invalid: inline observer with no use at all', requireObserverCleanup, {
  valid: [],
  invalid: [
    {
      code: `
        class Foo {
          connectedCallback() {
            new IntersectionObserver(() => {});
          }
        }
      `,
      errors: [{ messageId: 'inline-observer-leak', data: { kind: 'IntersectionObserver' } }]
    }
  ]
});

tester.run('valid: observer stored through a conditional or logical wrapper', requireObserverCleanup, {
  valid: [
    {
      code: `
        class Foo {
          #observer;
          connectedCallback(supportsResize) {
            this.#observer = supportsResize ? new ResizeObserver(() => {}) : new MutationObserver(() => {});
          }
        }
      `
    },
    {
      code: `
        class Foo {
          #observer;
          connectedCallback() {
            this.#observer = this.#observer ?? new ResizeObserver(() => {});
          }
        }
      `
    },
    {
      code: `
        class Foo {
          #observer;
          connectedCallback(maybe) {
            this.#observer = maybe || new MutationObserver(() => {});
          }
        }
      `
    },
    {
      code: `
        class Foo {
          #observer;
          connectedCallback(a, b) {
            this.#observer = a ?? (b ? new ResizeObserver(() => {}) : new MutationObserver(() => {}));
          }
        }
      `
    }
  ],
  invalid: []
});

tester.run('invalid: bare conditional expression still discards the observer', requireObserverCleanup, {
  valid: [],
  invalid: [
    {
      code: `
        class Foo {
          connectedCallback(cond) {
            cond ? new ResizeObserver(() => {}) : null;
          }
        }
      `,
      errors: [{ messageId: 'inline-observer-leak', data: { kind: 'ResizeObserver' } }]
    }
  ]
});

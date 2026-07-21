import { describe, expect, it } from 'vitest';
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import requireListenerCleanup from './require-listener-cleanup.js';

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

describe('require-listener-cleanup', () => {
  it('defines rule metadata', () => {
    expect(requireListenerCleanup.meta?.type).toBe('problem');
    expect(requireListenerCleanup.meta?.messages?.['missing-cleanup']).toBeTruthy();
    expect(requireListenerCleanup.meta?.messages?.['missing-teardown']).toBeTruthy();
    expect(requireListenerCleanup.meta?.messages?.['listener-in-constructor']).toBeTruthy();
  });
});

tester.run('invalid: addEventListener in the constructor', requireListenerCleanup, {
  valid: [],
  invalid: [
    {
      code: `
        class Foo {
          #handler = () => {};
          constructor() {
            super();
            this.shadowRoot?.addEventListener('input', this.#handler);
            this.shadowRoot?.addEventListener('change', this.#handler);
          }
        }
      `,
      errors: [
        { messageId: 'listener-in-constructor', data: { target: 'this.shadowRoot', event: "'input'" } },
        { messageId: 'listener-in-constructor', data: { target: 'this.shadowRoot', event: "'change'" } }
      ]
    }
  ]
});

tester.run('valid: add and remove paired with same target and event (default lifecycle pair)', requireListenerCleanup, {
  valid: [
    {
      code: `
        class Foo {
          #handler = () => {};
          connectedCallback() {
            document.addEventListener('change', this.#handler);
          }
          disconnectedCallback() {
            document.removeEventListener('change', this.#handler);
          }
        }
      `
    },
    {
      code: `
        class Foo {
          handler = () => {};
          connectedCallback() {
            this.shadowRoot?.addEventListener('input', this.handler);
            this.shadowRoot?.addEventListener('change', this.handler);
          }
          disconnectedCallback() {
            this.shadowRoot?.removeEventListener('input', this.handler);
            this.shadowRoot?.removeEventListener('change', this.handler);
          }
        }
      `
    },
    {
      code: `
        class Foo {
          render() {}
        }
      `
    },
    {
      code: `
        class Foo {
          connectedCallback() {
            this.setAttribute('data-ready', '');
          }
        }
      `
    },
    {
      code: `
        class Foo {
          #handler = () => {};
          connectedCallback() {
            if (this.enabled) {
              window.addEventListener('resize', this.#handler);
            }
          }
          disconnectedCallback() {
            window.removeEventListener('resize', this.#handler);
          }
        }
      `
    }
  ],
  invalid: []
});

tester.run('valid: self-cleaning listener options exempt the call from cleanup pairing', requireListenerCleanup, {
  valid: [
    {
      code: `
        class Foo {
          #onResize = () => {};
          #abort = new AbortController();
          connectedCallback() {
            window.addEventListener('resize', this.#onResize, { signal: this.#abort.signal });
          }
          disconnectedCallback() {
            this.#abort.abort();
          }
        }
      `
    },
    {
      code: `
        class Foo {
          #onClick = () => {};
          connectedCallback() {
            this.addEventListener('click', this.#onClick, { once: true });
          }
        }
      `
    },
    {
      code: `
        class Foo {
          #onResize = () => {};
          #abort = new AbortController();
          connectedCallback() {
            const signal = this.#abort.signal;
            window.addEventListener('resize', this.#onResize, { signal });
          }
          disconnectedCallback() {
            this.#abort.abort();
          }
        }
      `
    }
  ],
  invalid: []
});

tester.run('invalid: connectedCallback adds listener with no disconnectedCallback', requireListenerCleanup, {
  valid: [],
  invalid: [
    {
      code: `
        class Foo {
          #handler = () => {};
          connectedCallback() {
            this.shadowRoot?.addEventListener('input', this.#handler);
            this.shadowRoot?.addEventListener('change', this.#handler);
          }
        }
      `,
      errors: [
        {
          messageId: 'missing-teardown',
          data: { setup: 'connectedCallback', teardown: 'disconnectedCallback' }
        }
      ]
    }
  ]
});

tester.run('invalid: only some events are removed', requireListenerCleanup, {
  valid: [],
  invalid: [
    {
      code: `
        class Foo {
          #handler = () => {};
          connectedCallback() {
            this.shadowRoot?.addEventListener('input', this.#handler);
            this.shadowRoot?.addEventListener('change', this.#handler);
          }
          disconnectedCallback() {
            this.shadowRoot?.removeEventListener('change', this.#handler);
          }
        }
      `,
      errors: [
        {
          messageId: 'missing-cleanup',
          data: {
            target: 'this.shadowRoot',
            event: "'input'",
            setup: 'connectedCallback',
            teardown: 'disconnectedCallback'
          }
        }
      ]
    }
  ]
});

tester.run(
  'invalid: options that do not statically prove self-cleaning still require a matching removeEventListener',
  requireListenerCleanup,
  {
    valid: [],
    invalid: [
      {
        code: `
        class Foo {
          #handler = () => {};
          connectedCallback() {
            document.addEventListener('click', this.#handler, { once: false });
            window.addEventListener('scroll', this.#handler, { capture: true });
          }
          disconnectedCallback() {}
        }
      `,
        errors: [
          {
            messageId: 'missing-cleanup',
            data: { target: 'document', event: "'click'", setup: 'connectedCallback', teardown: 'disconnectedCallback' }
          },
          {
            messageId: 'missing-cleanup',
            data: { target: 'window', event: "'scroll'", setup: 'connectedCallback', teardown: 'disconnectedCallback' }
          }
        ]
      },
      {
        code: `
        class Foo {
          #handler = () => {};
          connectedCallback() {
            const options = { once: true };
            document.addEventListener('click', this.#handler, options);
          }
          disconnectedCallback() {}
        }
      `,
        errors: [
          {
            messageId: 'missing-cleanup',
            data: { target: 'document', event: "'click'", setup: 'connectedCallback', teardown: 'disconnectedCallback' }
          }
        ]
      }
    ]
  }
);

tester.run(
  'valid: add and remove attached through private helper methods (depth-1 follow-through)',
  requireListenerCleanup,
  {
    valid: [
      {
        code: `
        class Foo {
          #handler = () => {};
          connectedCallback() {
            super.connectedCallback();
            this.#setup();
          }
          disconnectedCallback() {
            super.disconnectedCallback();
            this.#teardown();
          }
          #setup() {
            this.shadowRoot.addEventListener('slotchange', this.#handler);
          }
          #teardown() {
            this.shadowRoot.removeEventListener('slotchange', this.#handler);
          }
        }
      `
      }
    ],
    invalid: []
  }
);

tester.run(
  'invalid: private helper adds a listener but disconnectedCallback does not remove it',
  requireListenerCleanup,
  {
    valid: [],
    invalid: [
      {
        code: `
        class Foo {
          #handler = () => {};
          connectedCallback() {
            super.connectedCallback();
            this.#setup();
          }
          disconnectedCallback() {
            super.disconnectedCallback();
          }
          #setup() {
            this.shadowRoot.addEventListener('slotchange', this.#handler);
          }
        }
      `,
        errors: [
          {
            messageId: 'missing-cleanup',
            data: {
              target: 'this.shadowRoot',
              event: "'slotchange'",
              setup: 'connectedCallback',
              teardown: 'disconnectedCallback'
            }
          }
        ]
      }
    ]
  }
);

tester.run('invalid: add in private helper, remove only for one of multiple listeners', requireListenerCleanup, {
  valid: [],
  invalid: [
    {
      code: `
        class Foo {
          #handler = () => {};
          connectedCallback() {
            super.connectedCallback();
            this.shadowRoot.addEventListener('slotchange', this.#handler);
            this.#setupInput();
          }
          disconnectedCallback() {
            super.disconnectedCallback();
            this.shadowRoot.removeEventListener('slotchange', this.#handler);
          }
          #setupInput() {
            this.input.addEventListener('input', this.#handler);
          }
        }
      `,
      errors: [
        {
          messageId: 'missing-cleanup',
          data: {
            target: 'this.input',
            event: "'input'",
            setup: 'connectedCallback',
            teardown: 'disconnectedCallback'
          }
        }
      ]
    }
  ]
});

tester.run('invalid: addEventListener in a private helper called from the constructor', requireListenerCleanup, {
  valid: [],
  invalid: [
    {
      code: `
        class Foo {
          #handler = () => {};
          constructor() {
            super();
            this.#attach();
          }
          #attach() {
            this.shadowRoot?.addEventListener('input', this.#handler);
          }
        }
      `,
      errors: [{ messageId: 'listener-in-constructor', data: { target: 'this.shadowRoot', event: "'input'" } }]
    }
  ]
});

tester.run('valid: does not follow through non-private (regular) method calls', requireListenerCleanup, {
  valid: [
    {
      code: `
        class Foo {
          #handler = () => {};
          connectedCallback() {
            super.connectedCallback();
            this.publicHelper();
          }
          publicHelper() {
            document.addEventListener('scroll', this.#handler);
          }
        }
      `
    }
  ],
  invalid: []
});

tester.run('valid: remove delegated to a private helper in disconnectedCallback', requireListenerCleanup, {
  valid: [
    {
      code: `
        class Foo {
          #handler = () => {};
          connectedCallback() {
            super.connectedCallback();
            this.shadowRoot.addEventListener('slotchange', this.#handler);
          }
          disconnectedCallback() {
            super.disconnectedCallback();
            this.#teardown();
          }
          #teardown() {
            this.shadowRoot.removeEventListener('slotchange', this.#handler);
          }
        }
      `
    }
  ],
  invalid: []
});

tester.run('valid: does not follow TypeScript-private (non-#) methods', requireListenerCleanup, {
  valid: [
    {
      code: `
        class Foo {
          handler = () => {};
          connectedCallback() {
            super.connectedCallback();
            this.setup();
          }
          private setup() {
            document.addEventListener('scroll', this.handler);
          }
        }
      `
    }
  ],
  invalid: []
});

tester.run('valid: mutually recursive private helpers do not cause infinite recursion', requireListenerCleanup, {
  valid: [
    {
      code: `
        class Foo {
          connectedCallback() {
            super.connectedCallback();
            this.#a();
          }
          #a() { this.#b(); }
          #b() { this.#a(); }
        }
      `
    }
  ],
  invalid: []
});

tester.run('invalid: target mismatch between add and remove', requireListenerCleanup, {
  valid: [],
  invalid: [
    {
      code: `
        class Foo {
          #handler = () => {};
          connectedCallback() {
            document.addEventListener('click', this.#handler);
          }
          disconnectedCallback() {
            window.removeEventListener('click', this.#handler);
          }
        }
      `,
      errors: [
        {
          messageId: 'missing-cleanup',
          data: { target: 'document', event: "'click'", setup: 'connectedCallback', teardown: 'disconnectedCallback' }
        }
      ]
    }
  ]
});

tester.run(
  'lifecyclePairs option - valid: a custom [setup, teardown] pair is matched instead of connectedCallback/disconnectedCallback',
  requireListenerCleanup,
  {
    valid: [
      {
        code: `
        class Foo {
          #handler = () => {};
          onMount() {
            document.addEventListener('resize', this.#handler);
          }
          onDestroy() {
            document.removeEventListener('resize', this.#handler);
          }
        }
      `,
        options: [{ lifecyclePairs: [['onMount', 'onDestroy']] }]
      }
    ],
    invalid: []
  }
);

tester.run(
  'lifecyclePairs option - invalid: a custom pair still reports a missing removeEventListener',
  requireListenerCleanup,
  {
    valid: [],
    invalid: [
      {
        code: `
        class Foo {
          #handler = () => {};
          onMount() {
            document.addEventListener('resize', this.#handler);
          }
          onDestroy() {}
        }
      `,
        options: [{ lifecyclePairs: [['onMount', 'onDestroy']] }],
        errors: [
          {
            messageId: 'missing-cleanup',
            data: { target: 'document', event: "'resize'", setup: 'onMount', teardown: 'onDestroy' }
          }
        ]
      }
    ]
  }
);

tester.run('lifecyclePairs option - invalid: a custom pair with no teardown method at all', requireListenerCleanup, {
  valid: [],
  invalid: [
    {
      code: `
        class Foo {
          #handler = () => {};
          onMount() {
            document.addEventListener('resize', this.#handler);
          }
        }
      `,
      options: [{ lifecyclePairs: [['onMount', 'onDestroy']] }],
      errors: [{ messageId: 'missing-teardown', data: { setup: 'onMount', teardown: 'onDestroy' } }]
    }
  ]
});

tester.run(
  'lifecyclePairs option - valid: configuring a custom pair no longer checks the default connectedCallback/disconnectedCallback pair',
  requireListenerCleanup,
  {
    valid: [
      {
        code: `
        class Foo {
          #handler = () => {};
          connectedCallback() {
            document.addEventListener('resize', this.#handler);
          }
          onMount() {}
          onDestroy() {}
        }
      `,
        options: [{ lifecyclePairs: [['onMount', 'onDestroy']] }]
      }
    ],
    invalid: []
  }
);

tester.run(
  'lifecyclePairs option - invalid: multiple configured pairs are each checked independently',
  requireListenerCleanup,
  {
    valid: [],
    invalid: [
      {
        code: `
        class Foo {
          #handler = () => {};
          connectedCallback() {
            document.addEventListener('click', this.#handler);
          }
          disconnectedCallback() {
            document.removeEventListener('click', this.#handler);
          }
          onMount() {
            window.addEventListener('resize', this.#handler);
          }
          onDestroy() {}
        }
      `,
        options: [
          {
            lifecyclePairs: [
              ['connectedCallback', 'disconnectedCallback'],
              ['onMount', 'onDestroy']
            ]
          }
        ],
        errors: [
          {
            messageId: 'missing-cleanup',
            data: { target: 'window', event: "'resize'", setup: 'onMount', teardown: 'onDestroy' }
          }
        ]
      }
    ]
  }
);

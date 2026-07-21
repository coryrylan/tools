# tools/require-listener-cleanup

Requires every `addEventListener` added in a setup lifecycle method to have a matching `removeEventListener` in the paired teardown method, and forbids `addEventListener` in the constructor.

## Why this matters for agents

An agent wiring up a feature reaches for `addEventListener` to make something work - a resize handler, a keyboard shortcut, a subscription to a global event bus - and once the feature behaves correctly, the task reads as done. Coming back later to add the matching `removeEventListener` requires the agent to remember an instance it did not just write, in a method it may not even be looking at (teardown methods are typically short and get visited far less often than setup code). Nothing about running the code surfaces the omission: the listener keeps firing, quietly, on every element that connects and disconnects. In a long-lived app, or one under test with elements attaching and reattaching repeatedly, these accumulate into duplicate side effects and memory that never gets released. This rule catches the gap at write time, while the setup code is still in the same diff as the fix.

It also flags `addEventListener` calls made directly in the constructor: the constructor runs exactly once per instance, so a listener attached there can never be paired with a teardown call - it leaks the first time the instance is torn down and recreated, and on top of that, many of the objects an agent might try to attach to (like a shadow root) are not even initialized yet at construction time.

## Examples

❌ Incorrect

```js
class MyWidget {
  #onResize = () => this.reflow();

  connectedCallback() {
    window.addEventListener('resize', this.#onResize);
  }
  // no disconnectedCallback at all - the listener is never removed
}
```

```js
class MyWidget {
  #onResize = () => this.reflow();

  connectedCallback() {
    window.addEventListener('resize', this.#onResize);
  }
  disconnectedCallback() {
    // wrong target: this leaves the `window` listener attached
    this.removeEventListener('resize', this.#onResize);
  }
}
```

```js
class MyWidget {
  #onClick = () => this.handleClick();

  constructor() {
    super();
    // the constructor runs once; this can never be cleaned up
    this.addEventListener('click', this.#onClick);
  }
}
```

✅ Correct

```js
class MyWidget {
  #onResize = () => this.reflow();

  connectedCallback() {
    window.addEventListener('resize', this.#onResize);
  }
  disconnectedCallback() {
    window.removeEventListener('resize', this.#onResize);
  }
}
```

A listener whose options argument statically proves it detaches itself needs no paired `removeEventListener` at all - `{ once: true }` self-removes after firing once, and `{ signal }` delegates teardown to whichever `AbortController` owns that signal (the rule does not require finding the matching `abort()` call; aborts legitimately live elsewhere):

```js
class MyWidget {
  #onResize = () => this.reflow();
  #abort = new AbortController();

  connectedCallback() {
    window.addEventListener('resize', this.#onResize, { signal: this.#abort.signal });
  }
  disconnectedCallback() {
    this.#abort.abort();
  }
}
```

This exemption only applies when the options argument is an object literal the rule can read statically. An options value that is a boolean, an identifier, a spread-only object, or has `once` set to anything other than the literal `true` does not qualify, and the call still requires a matching `removeEventListener`.

A setup method may delegate to a private helper method, and the rule still follows the listener one level deep:

```js
class MyWidget {
  #onSlotChange = () => this.sync();

  connectedCallback() {
    this.#attachListeners();
  }
  disconnectedCallback() {
    this.#detachListeners();
  }
  #attachListeners() {
    this.shadowRoot.addEventListener('slotchange', this.#onSlotChange);
  }
  #detachListeners() {
    this.shadowRoot.removeEventListener('slotchange', this.#onSlotChange);
  }
}
```

## Options

```js
{
  "tools/require-listener-cleanup": ["error", {
    "lifecyclePairs": [["connectedCallback", "disconnectedCallback"]]
  }]
}
```

- `lifecyclePairs` (`[string, string][]`, default `[["connectedCallback", "disconnectedCallback"]]`): the setup/teardown method name pairs to check. Each pair is checked independently, so multiple pairs may be configured at once - e.g. a framework that exposes both `connectedCallback`/`disconnectedCallback` and a custom `onMount`/`onDestroy` pair:

  ```js
  {
    "tools/require-listener-cleanup": ["error", {
      "lifecyclePairs": [
        ["connectedCallback", "disconnectedCallback"],
        ["onMount", "onDestroy"]
      ]
    }]
  }
  ```

  Configuring `lifecyclePairs` replaces the default entirely - include `["connectedCallback", "disconnectedCallback"]` explicitly if it should still be checked alongside a custom pair. The constructor check (`addEventListener` is never allowed there) always applies regardless of this option.

## When not to use it

- Codebases that rely on framework-managed listener directives (e.g. a template-binding syntax that attaches and removes listeners declaratively) instead of imperative `addEventListener`/`removeEventListener` calls, since the rule only understands the imperative form.
- Classes whose lifecycle methods are not a fixed, discoverable pair of names - the rule needs `lifecyclePairs` to name the exact setup/teardown methods, so highly dynamic or reflection-based lifecycle wiring will not be caught.

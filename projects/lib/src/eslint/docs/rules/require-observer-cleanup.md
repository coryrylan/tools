# tools/require-observer-cleanup

Flags `ResizeObserver`, `MutationObserver`, `IntersectionObserver`, and `PerformanceObserver` instances created inside a class without storing a reference, which prevents them from ever being disconnected.

## Why this matters for agents

Observers are easy to reach for and easy to get working in a single expression - `new ResizeObserver(cb).observe(this)` runs fine and the feature appears to work immediately. The problem only shows up later: without a stored reference, there is no way to call `.disconnect()`, so the observer keeps invoking its callback for the lifetime of the observed node (and, transitively, keeps that node and everything the callback closes over alive) even after the owning instance is torn down. Because the code runs correctly in the moment an agent writes and tests it, this class of leak tends to survive review - the failure mode is a slow accumulation of dangling observers, not an error at the call site. Catching it at lint time forces the reference to be captured while the class field to hold it is still an easy, local edit.

## Examples

❌ Incorrect

```js
class MyWidget {
  connectedCallback() {
    // reference discarded - this can never be disconnected
    new ResizeObserver(() => this.reflow()).observe(this);
  }
}
```

```js
class MyWidget {
  #ro;
  connectedCallback() {
    // `.observe()` returns undefined, so this stores nothing useful
    this.#ro = new ResizeObserver(() => this.reflow()).observe(this);
  }
}
```

✅ Correct

```js
class MyWidget {
  #ro;
  connectedCallback() {
    this.#ro = new ResizeObserver(() => this.reflow());
    this.#ro.observe(this);
  }
  disconnectedCallback() {
    this.#ro.disconnect();
  }
}
```

```js
class MyWidget {
  connectedCallback() {
    const observer = new MutationObserver(() => this.sync());
    observer.observe(this, { childList: true });
    // stored elsewhere the rule can see the reference is retained
    this.observers.push(observer);
  }
}
```

## Options

This rule has no options.

## When not to use it

- Code that intentionally creates a fire-and-forget observer scoped to something outside any class (e.g. a one-off module-scope observer on `document.body` for the lifetime of the page) - the rule only flags observers created inside a class body, so this case is unaffected, but if a similar pattern inside a class is genuinely intentional, disable the rule for that line.

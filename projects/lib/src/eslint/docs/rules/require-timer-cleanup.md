# tools/require-timer-cleanup

Flags `setInterval` calls whose handle is never stored, kept only in a local variable that is never cleared or handed off, and stored `setInterval`/`setTimeout` handles that are never passed to a matching `clearInterval`/`clearTimeout` anywhere in the class.

## Why this matters for agents

A timer is one of the fastest ways to make something "work" - poll for a condition, animate a value, retry a request - and the code runs correctly the moment it's written, whether or not the timer is ever cleared. Clearing it means touching a second, often distant, method (usually teardown), which is easy to skip when the primary goal was making the interval or timeout fire in the first place. An uncleared `setInterval` keeps firing for the lifetime of the page, not the lifetime of the instance that started it - including after that instance has been torn down - which turns into wasted work at best and a crash from operating on a disposed instance at worst. This rule catches the interval whose handle was never even kept (so it could never have been cleared), the handle that lives only in a local variable and disappears the moment the method returns, and the handle that was kept on the instance but never matched with a clear call.

## Examples

❌ Incorrect

```js
class Poller {
  connectedCallback() {
    // no handle stored - this interval can never be cleared
    setInterval(() => this.poll(), 1000);
  }
}
```

```js
class Poller {
  connectedCallback() {
    this.#intervalId = setInterval(() => this.poll(), 1000);
  }
  // disconnectedCallback exists, but never calls clearInterval
  disconnectedCallback() {}
}
```

```js
class Poller {
  start() {
    // `id` is local to start() - it disappears the moment start() returns,
    // so this interval can never be cleared either
    const id = setInterval(() => this.poll(), 1000);
  }
}
```

✅ Correct

```js
class Poller {
  #intervalId;
  connectedCallback() {
    this.#intervalId = setInterval(() => this.poll(), 1000);
  }
  disconnectedCallback() {
    clearInterval(this.#intervalId);
  }
}
```

A handle stored in a local variable is fine as long as its use shows the interval is actually stopped or handed off to something else that owns clearing it. The rule follows the local binding - via scope analysis, not just adjacent lines - to any of the following:

Cleared from within the same function, including from inside the interval's own callback:

```js
class Poller {
  connectedCallback() {
    const id = setInterval(() => this.tick(), 100);
    // ... later, still in scope ...
    clearInterval(id);
  }
}
```

```js
class Poller {
  start() {
    const id = setInterval(() => {
      if (this.done) {
        clearInterval(id);
      }
    }, 100);
  }
}
```

Returned to the caller, or assigned onward to a class member with a longer lifetime:

```js
class Poller {
  start() {
    return setInterval(() => this.tick(), 100);
  }
}
```

```js
class Poller {
  #timer;
  start() {
    const id = setInterval(() => this.tick(), 100);
    this.#timer = id;
  }
}
```

Handed off to an external owner that takes responsibility for clearing it:

```js
class Poller {
  start() {
    const id = setInterval(() => this.tick(), 100);
    registry.track(id);
  }
}
```

A one-shot `setTimeout` whose handle is discarded, local or otherwise, is fine - there is no lingering "keeps firing" failure mode for a timer that only ever fires once:

```js
class Poller {
  connectedCallback() {
    setTimeout(() => this.warmUp(), 0);
  }
}
```

## Options

This rule has no options.

## When not to use it

- Code where a `setInterval`/`setTimeout` handle is deliberately stored somewhere the rule cannot see as "this class" and cannot trace as a handed-off local variable - e.g. stashed in a module-level `Map` keyed by instance. Disable the rule at that call site rather than broadly, so the rest of the class still gets checked.

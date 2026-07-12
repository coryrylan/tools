# tools/no-deep-class-inheritance

Disallow class inheritance chains deeper than a configured maximum.

## Why this matters for agents

Asked to make "a slightly different X", an agent will often subclass X rather than compose the new behavior alongside it - and the habit compounds, because each additional layer looks reasonable in isolation. Three or four subclasses later, understanding what any single class actually does requires reading the whole chain up to its root, tracking overridden methods and fields across every hop. That whole-chain read is exactly the kind of expensive, easy-to-skip context that produces bugs: an agent edits one class in the chain without realizing a sibling three levels down overrides the method it just changed. Capping the depth forces the composition decision to happen explicitly instead of by default.

## Examples

❌ Incorrect (with the default `maxDepth: 2`):

```ts
class WidgetBase {}
class InteractiveWidget extends WidgetBase {}
class DraggableWidget extends InteractiveWidget {}
class SnappingDraggableWidget extends DraggableWidget {}
// SnappingDraggableWidget's chain is 3 hops deep: DraggableWidget ->
// InteractiveWidget -> WidgetBase.
```

✅ Correct:

```ts
class WidgetBase {}
class InteractiveWidget extends WidgetBase {}
class DraggableWidget extends InteractiveWidget {}

// Snapping is a capability, not another layer of "-ness" - compose it in
// instead of subclassing again.
class SnappingDraggableWidget extends DraggableWidget {
  #snapping = createSnapBehavior(this);
}
```

## Options

```ts
interface Options {
  /** Maximum number of superclass hops allowed before an allowed root is reached. */
  maxDepth?: number; // default: 2

  /**
   * Class names that end the depth count early once reached, for local
   * wrappers around a trusted framework/platform base. Not transitive -
   * only the exact name is checked, not everything the named class itself extends.
   */
  allowedRoots?: string[]; // default: []
}
```

This rule requires type information (`parserOptions.projectService` or `project`) to resolve each superclass's own declaration; without it, the rule silently does nothing.

## When not to use it

Skip this rule for code that legitimately models a deep, stable taxonomy (for example, a generated class hierarchy mirroring an external schema), or in a codebase using a UI framework whose idiomatic pattern is several fixed base-class layers (e.g. `Component` -> `StatefulComponent` -> `YourComponent`) - raise `maxDepth` or add the framework's own base classes to `allowedRoots` instead of disabling it outright.

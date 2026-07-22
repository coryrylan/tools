/**
 * ESLint rule that catches event listener leaks in class-based lifecycles
 * (custom elements, and anything else that exposes a paired setup/teardown
 * method, e.g. `onMount`/`onDestroy`).
 */
import type { Rule } from 'eslint';
import { normalize, walk } from './utils.js';

type ClassLikeNode = Extract<Rule.Node, { type: 'ClassDeclaration' | 'ClassExpression' }>;
type ClassElement = ClassLikeNode['body']['body'][number];
type MethodDefinitionNode = Extract<ClassElement, { type: 'MethodDefinition' }>;
type CallExpressionNode = Extract<Rule.Node, { type: 'CallExpression' }>;
type CallArgumentNode = CallExpressionNode['arguments'][number];
type ObjectExpressionNode = Extract<CallArgumentNode, { type: 'ObjectExpression' }>;
type ObjectPropertyNode = ObjectExpressionNode['properties'][number];

/** A `[setupMethod, teardownMethod]` name pair, e.g. `['connectedCallback', 'disconnectedCallback']`. */
type LifecyclePair = readonly [string, string];

/** Shape of the (already schema-validated) options object, read defensively. */
interface RawOptions {
  readonly lifecyclePairs?: unknown;
}

/** A resolved `addEventListener`/`removeEventListener` call site. */
interface ListenerCall {
  readonly node: CallExpressionNode;
  readonly target: string;
  readonly event: string;
}

/** Bundles the pieces every helper below needs so none of them exceed the max-params budget. */
interface CheckEnv {
  readonly context: Rule.RuleContext;
  readonly classNode: ClassLikeNode;
}

interface UnmatchedCheck {
  readonly addCalls: readonly ListenerCall[];
  readonly removeCalls: readonly ListenerCall[];
  readonly setupName: string;
  readonly teardownName: string;
}

const DEFAULT_LIFECYCLE_PAIRS: readonly LifecyclePair[] = [['connectedCallback', 'disconnectedCallback']];

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Ensures addEventListener calls in a setup lifecycle method have a matching removeEventListener in the paired teardown method, and forbids addEventListener in the constructor.',
      recommended: true
    },
    schema: [
      {
        type: 'object',
        properties: {
          lifecyclePairs: {
            type: 'array',
            items: {
              type: 'array',
              items: [{ type: 'string' }, { type: 'string' }],
              minItems: 2,
              maxItems: 2
            }
          }
        },
        additionalProperties: false
      }
    ],
    messages: {
      'missing-cleanup':
        '`addEventListener` on `{{target}}` for `{{event}}` is called in {{setup}}() but no matching `removeEventListener` is called in {{teardown}}(). Attach the listener via a class field and remove the same reference in {{teardown}}() to prevent a listener leak when {{setup}} runs again.',
      'missing-teardown':
        '{{setup}}() attaches event listeners but the class has no {{teardown}}(). Add a {{teardown}}() that removes each listener with its original reference to prevent a leak when {{setup}} runs again.',
      'listener-in-constructor':
        '`addEventListener` on `{{target}}` for `{{event}}` is called in the constructor. The constructor runs once per instance, so this listener cannot be paired with a teardown call and leaks if the instance is torn down and recreated. Move the call into a setup lifecycle method and pair it with a matching removeEventListener in the corresponding teardown method.'
    }
  },
  create(context) {
    const pairs = getLifecyclePairs(context);
    const handleClass = (node: ClassLikeNode): void => {
      checkClass({ context, classNode: node }, pairs);
    };
    return {
      ClassDeclaration: handleClass,
      ClassExpression: handleClass
    };
  }
};

export default rule;

function checkClass(env: CheckEnv, pairs: readonly LifecyclePair[]): void {
  checkConstructor(env);
  for (const pair of pairs) {
    checkPair(env, pair);
  }
}

function checkConstructor(env: CheckEnv): void {
  const ctor = findConstructor(env.classNode);
  if (!ctor) {
    return;
  }
  for (const add of collectListenerCalls(env, ctor, 'addEventListener')) {
    env.context.report({
      node: add.node,
      messageId: 'listener-in-constructor',
      data: { target: add.target, event: add.event }
    });
  }
}

function checkPair(env: CheckEnv, pair: LifecyclePair): void {
  const [setupName, teardownName] = pair;
  const setup = findMethod(env.classNode, setupName);
  if (!setup) {
    return;
  }

  const addCalls = collectListenerCalls(env, setup, 'addEventListener').filter(
    add => !isSelfCleaningListenerCall(add.node)
  );
  if (addCalls.length === 0) {
    return;
  }

  const teardown = findMethod(env.classNode, teardownName);
  if (!teardown) {
    env.context.report({
      node: setup,
      messageId: 'missing-teardown',
      data: { setup: setupName, teardown: teardownName }
    });
    return;
  }

  const removeCalls = collectListenerCalls(env, teardown, 'removeEventListener');
  reportUnmatched(env, { addCalls, removeCalls, setupName, teardownName });
}

/**
 * Self-detaching options skip the paired `removeEventListener`:
 * `once: true` self-removes; `signal` defers to whatever aborts it.
 * https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener#options
 * Non-literal options still need one.
 */
function isSelfCleaningListenerCall(node: CallExpressionNode): boolean {
  const optionsArg = node.arguments[2];
  if (!optionsArg || optionsArg.type !== 'ObjectExpression') {
    return false;
  }
  return optionsArg.properties.some(property => isAbortSignalProperty(property) || isOnceTrueProperty(property));
}

function isAbortSignalProperty(property: ObjectPropertyNode): boolean {
  return getStaticPropertyName(property) === 'signal';
}

function isOnceTrueProperty(property: ObjectPropertyNode): boolean {
  if (property.type !== 'Property' || getStaticPropertyName(property) !== 'once') {
    return false;
  }
  return property.value.type === 'Literal' && property.value.value === true;
}

function getStaticPropertyName(property: ObjectPropertyNode): string | null {
  if (property.type !== 'Property' || property.computed) {
    return null;
  }
  if (property.key.type === 'Identifier') {
    return property.key.name;
  }
  return property.key.type === 'Literal' && typeof property.key.value === 'string' ? property.key.value : null;
}

function reportUnmatched(env: CheckEnv, check: UnmatchedCheck): void {
  for (const add of check.addCalls) {
    const hasMatch = check.removeCalls.some(remove => remove.target === add.target && remove.event === add.event);
    if (!hasMatch) {
      env.context.report({
        node: add.node,
        messageId: 'missing-cleanup',
        data: { target: add.target, event: add.event, setup: check.setupName, teardown: check.teardownName }
      });
    }
  }
}

function findConstructor(classNode: ClassLikeNode): MethodDefinitionNode | null {
  for (const member of classNode.body.body) {
    if (member.type === 'MethodDefinition' && member.kind === 'constructor') {
      return member;
    }
  }
  return null;
}

function findMethod(classNode: ClassLikeNode, name: string): MethodDefinitionNode | null {
  for (const member of classNode.body.body) {
    if (isNamedMethod(member, name)) {
      return member;
    }
  }
  return null;
}

function isNamedMethod(member: ClassElement, name: string): member is MethodDefinitionNode {
  return (
    member.type === 'MethodDefinition' && !member.static && member.key.type === 'Identifier' && member.key.name === name
  );
}

/**
 * Collects `methodName` calls in `methodNode`'s own body, plus (depth-1 only)
 * calls made from any private helper method that `methodNode` calls directly
 * - the common pattern of a lifecycle method delegating to `#setup()`/`#teardown()`.
 */
function collectListenerCalls(env: CheckEnv, methodNode: MethodDefinitionNode, methodName: string): ListenerCall[] {
  const results = collectInBody(env.context, methodNode.value.body, methodName);
  const visited = new Set<MethodDefinitionNode>([methodNode]);

  walk(methodNode.value.body, node => {
    if (node.type !== 'CallExpression') {
      return;
    }
    const resolved = resolvePrivateMethodCall(node, env.classNode);
    if (!resolved || visited.has(resolved)) {
      return;
    }
    visited.add(resolved);
    results.push(...collectInBody(env.context, resolved.value.body, methodName));
  });

  return results;
}

function collectInBody(context: Rule.RuleContext, body: unknown, methodName: string): ListenerCall[] {
  const results: ListenerCall[] = [];
  walk(body, node => {
    if (node.type !== 'CallExpression') {
      return;
    }
    const call = matchListenerCall(context, node, methodName);
    if (call) {
      results.push(call);
    }
  });
  return results;
}

function matchListenerCall(
  context: Rule.RuleContext,
  node: CallExpressionNode,
  methodName: string
): ListenerCall | null {
  const callee = node.callee;
  if (callee.type !== 'MemberExpression') {
    return null;
  }
  const property = callee.property;
  if (property.type !== 'Identifier' || property.name !== methodName) {
    return null;
  }
  const eventArg = node.arguments[0];
  if (!eventArg) {
    return null;
  }
  return {
    node,
    target: normalize(context.sourceCode.getText(callee.object)),
    event: normalize(context.sourceCode.getText(eventArg))
  };
}

function resolvePrivateMethodCall(callNode: CallExpressionNode, classNode: ClassLikeNode): MethodDefinitionNode | null {
  const callee = callNode.callee;
  if (callee.type !== 'MemberExpression') {
    return null;
  }
  if (callee.object.type !== 'ThisExpression' || callee.property.type !== 'PrivateIdentifier') {
    return null;
  }
  const name = callee.property.name;
  for (const member of classNode.body.body) {
    if (isPrivateMethod(member, name)) {
      return member;
    }
  }
  return null;
}

function isPrivateMethod(member: ClassElement, name: string): member is MethodDefinitionNode {
  return (
    member.type === 'MethodDefinition' &&
    !member.static &&
    member.kind === 'method' &&
    member.key.type === 'PrivateIdentifier' &&
    member.key.name === name
  );
}

function getLifecyclePairs(context: Rule.RuleContext): readonly LifecyclePair[] {
  const raw: unknown = context.options[0];
  if (!hasLifecyclePairsField(raw) || !Array.isArray(raw.lifecyclePairs)) {
    return DEFAULT_LIFECYCLE_PAIRS;
  }
  const pairs = raw.lifecyclePairs.filter(isLifecyclePair);
  return pairs.length > 0 ? pairs : DEFAULT_LIFECYCLE_PAIRS;
}

function hasLifecyclePairsField(value: unknown): value is RawOptions {
  return typeof value === 'object' && value !== null;
}

function isLifecyclePair(value: unknown): value is LifecyclePair {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && typeof value[1] === 'string';
}

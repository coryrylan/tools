/**
 * Flags timer leaks in class bodies: unstored `setInterval` (can't be
 * cleared), a local handle never cleared or handed off, and stored
 * `setInterval`/`setTimeout` handles never passed to a matching
 * `clearInterval`/`clearTimeout`.
 */
import type { Rule, Scope } from 'eslint';
import { findEnclosingClass, normalize, walk } from './utils.js';

type CallExpressionNode = Extract<Rule.Node, { type: 'CallExpression' }>;
type ClassLikeNode = Extract<Rule.Node, { type: 'ClassDeclaration' | 'ClassExpression' }>;
type PropertyDefinitionNode = Extract<Rule.Node, { type: 'PropertyDefinition' }>;
type VariableDeclaratorNode = Extract<Rule.Node, { type: 'VariableDeclarator' }>;
type IdentifierNode = Extract<Rule.Node, { type: 'Identifier' }>;
type CalleeNode = CallExpressionNode['callee'];
type AssignmentLeft = Extract<Rule.Node, { type: 'AssignmentExpression' }>['left'];

interface TimerCallInfo {
  readonly fnName: string;
  readonly classNode: ClassLikeNode;
}

interface StoredTimerInfo extends TimerCallInfo {
  readonly stored: string;
}

interface ClearSearch {
  readonly clearName: string;
  readonly targetText: string;
}

const SET_FNS = new Set(['setInterval', 'setTimeout']);
const CLEAR_FNS = new Set(['clearInterval', 'clearTimeout']);

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Flags setInterval without a stored handle, and stored setInterval/setTimeout calls whose handle is never cleared, in class bodies.',
      recommended: true
    },
    schema: [],
    messages: {
      'unstoppable-interval':
        '`setInterval(...)` result is not stored, so the interval cannot be cleared. Assign it to a class field (e.g., `this.#intervalId = setInterval(...)`) and call `clearInterval(this.#intervalId)` in the teardown lifecycle method to stop the interval when the instance is torn down.',
      'missing-timer-cleanup':
        '`{{fn}}(...)` result is stored on `{{target}}` but no matching `{{clear}}({{target}})` is called anywhere in the class. Clear the timer in the teardown lifecycle method so it does not fire after the instance is gone.'
    }
  },
  create(context) {
    return {
      CallExpression(node) {
        const fnName = getTimerFnName(node.callee);
        if (!fnName) {
          return;
        }
        const classNode = findEnclosingClass(node);
        if (!classNode) {
          return;
        }
        classifyAndReport(context, node, { fnName, classNode });
      }
    };
  }
};

export default rule;

function getTimerFnName(callee: CalleeNode): string | null {
  if (callee.type === 'Identifier' && SET_FNS.has(callee.name)) {
    return callee.name;
  }
  if (
    callee.type === 'MemberExpression' &&
    callee.property.type === 'Identifier' &&
    SET_FNS.has(callee.property.name)
  ) {
    return callee.property.name;
  }
  return null;
}

function classifyAndReport(context: Rule.RuleContext, callNode: CallExpressionNode, info: TimerCallInfo): void {
  const parent = callNode.parent;
  const stored = getStoredMemberText(parent, callNode, context);
  if (stored) {
    reportIfNotCleared(context, callNode, { ...info, stored });
    return;
  }
  if (info.fnName !== 'setInterval') {
    return;
  }
  if (parent.type === 'ExpressionStatement') {
    context.report({ node: callNode, messageId: 'unstoppable-interval' });
    return;
  }
  const localHandle = getLocalIntervalHandleDeclarator(parent, callNode);
  if (localHandle && !localIntervalHandleIsClearedOrEscapes(context, localHandle)) {
    context.report({ node: callNode, messageId: 'unstoppable-interval' });
  }
}

function reportIfNotCleared(context: Rule.RuleContext, callNode: CallExpressionNode, info: StoredTimerInfo): void {
  const clearName = info.fnName === 'setInterval' ? 'clearInterval' : 'clearTimeout';
  if (classHasClearForTarget(info.classNode, { clearName, targetText: info.stored }, context)) {
    return;
  }
  context.report({
    node: callNode,
    messageId: 'missing-timer-cleanup',
    data: { fn: info.fnName, target: info.stored, clear: clearName }
  });
}

function getStoredMemberText(
  parent: Rule.Node,
  callNode: CallExpressionNode,
  context: Rule.RuleContext
): string | null {
  if (parent.type === 'AssignmentExpression' && parent.right === callNode) {
    return thisMemberText(parent.left, context);
  }
  if (parent.type === 'PropertyDefinition' && parent.value === callNode) {
    return propertyDefinitionAsThisMember(parent, context);
  }
  return null;
}

function thisMemberText(node: AssignmentLeft, context: Rule.RuleContext): string | null {
  if (node.type !== 'MemberExpression') {
    return null;
  }
  if (node.object.type !== 'ThisExpression') {
    return null;
  }
  return normalize(context.sourceCode.getText(node));
}

function propertyDefinitionAsThisMember(node: PropertyDefinitionNode, context: Rule.RuleContext): string | null {
  if (node.static) {
    return null;
  }
  const key = node.key;
  if (key.type === 'PrivateIdentifier') {
    return `this.#${key.name}`;
  }
  if (key.type === 'Identifier') {
    return `this.${key.name}`;
  }
  return `this[${context.sourceCode.getText(key)}]`;
}

/**
 * Matches `const id = setInterval(...)` (`const`/`let`/`var`) where the
 * handle binds to a plain identifier, not a destructured pattern -
 * destructuring can't resolve back to a single traceable binding, so it's
 * outside this rule's scope-analysis path.
 */
function getLocalIntervalHandleDeclarator(
  parent: Rule.Node,
  callNode: CallExpressionNode
): VariableDeclaratorNode | null {
  if (parent.type !== 'VariableDeclarator' || parent.init !== callNode || parent.id.type !== 'Identifier') {
    return null;
  }
  return parent;
}

/**
 * A local handle is safe unstored on `this` when every use is cleared or
 * handed off: passed to a call (`clearInterval(id)`, `registry.track(id)`),
 * returned, or reassigned (`this.#timer = id`). Scope analysis resolves
 * closures to the same variable.
 */
function localIntervalHandleIsClearedOrEscapes(context: Rule.RuleContext, declarator: VariableDeclaratorNode): boolean {
  const [handleVariable] = context.sourceCode.getDeclaredVariables(declarator);
  if (!handleVariable) {
    return true;
  }
  return handleVariable.references.some(reference => referenceClearsOrReleasesHandle(reference));
}

function referenceClearsOrReleasesHandle(reference: Scope.Reference): boolean {
  const identifier = reference.identifier as unknown as IdentifierNode;
  const parent = identifier.parent;
  if (parent.type === 'CallExpression') {
    return parent.arguments.includes(identifier);
  }
  if (parent.type === 'ReturnStatement') {
    return parent.argument === identifier;
  }
  if (parent.type === 'AssignmentExpression') {
    return parent.right === identifier;
  }
  return false;
}

function classHasClearForTarget(classNode: ClassLikeNode, search: ClearSearch, context: Rule.RuleContext): boolean {
  let found = false;
  walk(classNode.body, node => {
    if (found || node.type !== 'CallExpression') {
      return;
    }
    if (getClearFnName(node.callee) !== search.clearName) {
      return;
    }
    const firstArg = node.arguments[0];
    if (firstArg && normalize(context.sourceCode.getText(firstArg)) === search.targetText) {
      found = true;
    }
  });
  return found;
}

function getClearFnName(callee: CalleeNode): string | null {
  if (callee.type === 'Identifier' && CLEAR_FNS.has(callee.name)) {
    return callee.name;
  }
  if (
    callee.type === 'MemberExpression' &&
    callee.property.type === 'Identifier' &&
    CLEAR_FNS.has(callee.property.name)
  ) {
    return callee.property.name;
  }
  return null;
}

/**
 * ESLint rule that flags observer instances (ResizeObserver, MutationObserver,
 * IntersectionObserver, PerformanceObserver) whose reference is discarded,
 * making disposal impossible.
 */
import type { Rule } from 'eslint';
import { findEnclosingClass } from './utils.js';

type NewExpressionNode = Extract<Rule.Node, { type: 'NewExpression' }>;
type TransparentWrapperNode = Extract<Rule.Node, { type: 'ConditionalExpression' | 'LogicalExpression' }>;
type RetentionCheckNode = NewExpressionNode | TransparentWrapperNode;

const OBSERVER_NAMES = new Set(['ResizeObserver', 'MutationObserver', 'IntersectionObserver', 'PerformanceObserver']);

const RETAINED_CONTAINER_TYPES = new Set([
  'ReturnStatement',
  'ArrowFunctionExpression',
  'ArrayExpression',
  'SpreadElement'
]);

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Flags observer instances created without storing a reference, which prevents them from being disconnected.',
      recommended: true
    },
    schema: [],
    messages: {
      'inline-observer-leak':
        'The `{{kind}}` is created but its reference is discarded, so it can never be `.disconnect()`-ed. Assign it to a class field (e.g., `this.#observer = new {{kind}}(...)`) and call `this.#observer.disconnect()` in the teardown lifecycle method to prevent the callback from firing on a detached instance.'
    }
  },
  create(context) {
    return {
      NewExpression(node) {
        if (node.callee.type !== 'Identifier' || !OBSERVER_NAMES.has(node.callee.name)) {
          return;
        }
        if (!findEnclosingClass(node)) {
          return;
        }
        if (isReferenceRetained(node)) {
          return;
        }
        context.report({
          node,
          messageId: 'inline-observer-leak',
          data: { kind: node.callee.name }
        });
      }
    };
  }
};

export default rule;

function isReferenceRetained(node: RetentionCheckNode): boolean {
  const parent = node.parent;
  if (isTransparentWrapper(parent, node)) {
    return isReferenceRetained(parent);
  }
  if (RETAINED_CONTAINER_TYPES.has(parent.type)) {
    return true;
  }
  if (isRetainedAssignmentTarget(parent, node)) {
    return true;
  }
  return isRetainedCallArgument(parent, node);
}

/**
 * `?:` and `??`/`||` forward one operand through as their own result, so an
 * observer sitting in a forwarded branch is exactly as retained as the
 * wrapper expression - the caller re-runs the same retention check one level
 * up. A `ConditionalExpression` `test` is consumed for its boolean-ness, not
 * forwarded, so an observer there is still a discarded leak.
 */
function isTransparentWrapper(parent: Rule.Node, node: RetentionCheckNode): parent is TransparentWrapperNode {
  if (parent.type === 'ConditionalExpression') {
    return parent.consequent === node || parent.alternate === node;
  }
  if (parent.type === 'LogicalExpression') {
    return parent.left === node || parent.right === node;
  }
  return false;
}

function isRetainedAssignmentTarget(parent: Rule.Node, node: RetentionCheckNode): boolean {
  if (parent.type === 'VariableDeclarator') {
    return parent.init === node;
  }
  if (parent.type === 'AssignmentExpression') {
    return parent.right === node;
  }
  if (parent.type === 'PropertyDefinition') {
    return parent.value === node;
  }
  if (parent.type === 'Property') {
    return parent.value === node;
  }
  return false;
}

function isRetainedCallArgument(parent: Rule.Node, node: RetentionCheckNode): boolean {
  if (parent.type === 'CallExpression' || parent.type === 'NewExpression') {
    return parent.arguments.includes(node);
  }
  return false;
}

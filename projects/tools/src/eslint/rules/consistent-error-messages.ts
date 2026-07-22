/**
 * Requires thrown/constructed `Error`s (and subclasses) to carry a
 * non-empty, informative message. Agents routinely emit placeholder throw
 * sites (`new Error('error')`, `new Error('')`); catching this in lint beats
 * catching it in production debugging.
 */
import type { Rule } from 'eslint';
import type { TemplateLiteral } from 'estree';

/** Shape of the (already schema-validated) options object, read defensively. */
interface RawOptions {
  readonly disallow?: readonly string[];
  readonly allowLowercase?: boolean;
}

/** Resolved options after defaults have been applied. */
interface ConsistentErrorMessagesOptions {
  readonly disallow: readonly string[];
  readonly allowLowercase: boolean;
}

const DEFAULT_DENYLIST: readonly string[] = [
  'error',
  'err',
  'failed',
  'failure',
  'oops',
  'something went wrong',
  'unknown error',
  'invalid',
  'bad'
];

function readOptions(context: Rule.RuleContext): ConsistentErrorMessagesOptions {
  const provided = context.options[0] as RawOptions | undefined;
  return {
    disallow: provided?.disallow ?? DEFAULT_DENYLIST,
    allowLowercase: provided?.allowLowercase ?? false
  };
}

/**
 * Error-constructor-shaped names this rule targets (built-ins and custom
 * `*Error` classes), excluding `AggregateError`. Requires PascalCase so
 * helpers merely named `reportError`/`logError`/`handleError`/`onError`
 * aren't mistaken for constructors.
 */
function isErrorConstructorName(name: string): boolean {
  return name !== 'AggregateError' && /^[A-Z]/.test(name) && /Error$/.test(name);
}

type NewOrCallExpressionNode = Extract<Rule.Node, { type: 'NewExpression' | 'CallExpression' }>;

/** Extracts the callee's identifier name, or `null` if the callee isn't a plain identifier. */
function calleeName(node: NewOrCallExpressionNode): string | null {
  return node.callee.type === 'Identifier' ? node.callee.name : null;
}

type Verdict = {
  readonly messageId: 'emptyMessage' | 'lowercaseMessage' | 'noiseMessage';
  readonly text?: string;
} | null;

/** Shared trim/noise/lowercase analysis for a message's literal text, used for both string literals and template-literal leading quasis. */
function analyzeText(text: string, options: ConsistentErrorMessagesOptions): Verdict {
  const trimmed = text.trim();
  if (trimmed === '') {
    return { messageId: 'emptyMessage' };
  }

  const lower = trimmed.toLowerCase();
  if (options.disallow.some(entry => entry.toLowerCase() === lower)) {
    return { messageId: 'noiseMessage', text: trimmed };
  }

  if (!options.allowLowercase && /^[a-z]/.test(trimmed)) {
    return { messageId: 'lowercaseMessage' };
  }

  return null;
}

/**
 * A template literal starting with `${` (empty leading quasi, at least one
 * expression) is always informative. Typed as plain `estree` (not
 * `Rule.Node`): it's a call argument, not a traversed node, so it has no
 * `.parent` back-pointer.
 */
function analyzeTemplateLiteral(node: TemplateLiteral, options: ConsistentErrorMessagesOptions): Verdict {
  const firstQuasi = node.quasis[0];
  const cooked = firstQuasi?.value.cooked ?? '';
  const startsWithInterpolation = node.expressions.length > 0 && cooked === '';
  if (startsWithInterpolation) {
    return null;
  }
  return analyzeText(cooked, options);
}

/** Analyzes the first argument to a flagged Error constructor/call, or `null` if it's not a message-shaped literal worth checking. */
function analyzeFirstArgument(
  firstArgument: NewOrCallExpressionNode['arguments'][number],
  options: ConsistentErrorMessagesOptions
): Verdict {
  if (firstArgument.type === 'Literal' && typeof firstArgument.value === 'string') {
    return analyzeText(firstArgument.value, options);
  }
  if (firstArgument.type === 'TemplateLiteral') {
    return analyzeTemplateLiteral(firstArgument, options);
  }
  return null;
}

function checkNode(
  context: Rule.RuleContext,
  node: NewOrCallExpressionNode,
  options: ConsistentErrorMessagesOptions
): void {
  const name = calleeName(node);
  if (name === null || !isErrorConstructorName(name)) {
    return;
  }

  const [firstArgument] = node.arguments;
  if (!firstArgument) {
    context.report({ node, messageId: 'missingMessage' });
    return;
  }

  const verdict = analyzeFirstArgument(firstArgument, options);
  if (!verdict) {
    return;
  }
  if (verdict.messageId === 'noiseMessage') {
    context.report({ node, messageId: 'noiseMessage', data: { text: verdict.text ?? '' } });
    return;
  }
  context.report({ node, messageId: verdict.messageId });
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require Error (and subclass) constructor/call sites to carry a non-empty, informative message.',
      recommended: true
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          disallow: { type: 'array', items: { type: 'string' } },
          allowLowercase: { type: 'boolean' }
        }
      }
    ],
    messages: {
      missingMessage: 'Construct errors with a message',
      emptyMessage: 'Error message must not be empty',
      lowercaseMessage: 'Error message should start with a capital letter or interpolated identifier',
      noiseMessage: "Error message '{{text}}' is low-information noise; describe what failed and why"
    }
  },
  create(context) {
    const options = readOptions(context);

    return {
      NewExpression(node) {
        checkNode(context, node, options);
      },
      CallExpression(node) {
        checkNode(context, node, options);
      }
    };
  }
};

export default rule;

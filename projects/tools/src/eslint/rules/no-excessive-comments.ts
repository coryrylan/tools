/**
 * Long JSDoc prose drifts stale as code moves on; an agent reading it
 * inherits stale description as fact. Budgeting prose per comment forces
 * detail into types and tests - which the toolchain keeps honest - instead
 * of unchecked paragraphs.
 */

import type { Rule } from 'eslint';
import type { Comment } from 'estree';

/** Options for the `no-excessive-comments` rule. */
export interface NoExcessiveCommentsOptions {
  /** Maximum free-form prose characters allowed across a single JSDoc comment. */
  readonly max: number;
}

const DEFAULT_MAX = 250;

/**
 * Tags whose first token after an optional `{type}` is a name, not prose
 * (`@param foo`, `@property bar`). The name is dropped from the budget; only
 * the trailing description counts.
 */
const NAME_BEARING_TAGS = new Set(['param', 'arg', 'argument', 'property', 'prop', 'typedef', 'template', 'callback']);

/** Tags whose body is code rather than prose, excluded from the budget entirely. */
const CODE_TAGS = new Set(['example']);

interface Segment {
  readonly tag: string | null;
  readonly text: string;
}

/** Strips the decorative leading ` * ` that opens each JSDoc line. */
function stripLeadingStar(line: string): string {
  return line.replace(/^\s*\*? ?/, '');
}

/**
 * Splits a JSDoc body into segments: the leading description (`tag: null`)
 * followed by one segment per `@tag` block. Continuation lines attach to the
 * segment they follow, so multi-line tag descriptions stay whole.
 */
function toSegments(value: string): Segment[] {
  const segments: Segment[] = [{ tag: null, text: '' }];
  for (const raw of value.split('\n')) {
    const line = stripLeadingStar(raw);
    const tagMatch = line.match(/^@(\S+)\s*(.*)$/);
    if (tagMatch) {
      segments.push({ tag: tagMatch[1] ?? null, text: tagMatch[2] ?? '' });
    } else {
      const current = segments[segments.length - 1];
      if (current) {
        segments[segments.length - 1] = { tag: current.tag, text: `${current.text} ${line}` };
      }
    }
  }
  return segments;
}

/** The prose a single segment contributes: `{type}` and name tokens removed. */
function segmentProse(segment: Segment): string {
  if (segment.tag === null) {
    return segment.text;
  }
  if (CODE_TAGS.has(segment.tag)) {
    return '';
  }
  const withoutType = segment.text.replace(/^\s*\{[^}]*\}/, '');
  return NAME_BEARING_TAGS.has(segment.tag) ? withoutType.replace(/^\s*\S+/, '') : withoutType;
}

/** Total free-form prose length across a JSDoc comment, whitespace-normalized. */
function proseLength(value: string): number {
  return toSegments(value).map(segmentProse).join(' ').replace(/\s+/g, ' ').trim().length;
}

function readOptions(context: Rule.RuleContext): NoExcessiveCommentsOptions {
  const provided = context.options[0] as Partial<NoExcessiveCommentsOptions> | undefined;
  return { max: provided?.max ?? DEFAULT_MAX };
}

/** Whether a comment is a JSDoc block (`/** ... `), the only kind this rule budgets. */
function isJsDoc(comment: Comment): boolean {
  return comment.type === 'Block' && comment.value.startsWith('*');
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Limit total free-form prose length across a JSDoc comment.'
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          max: { type: 'integer', minimum: 0 }
        }
      }
    ],
    messages: {
      'excessive-prose':
        'JSDoc prose is {{actual}} chars (max {{max}}) - encode the detail in types and tests, not prose.'
    }
  },
  create(context) {
    const { max } = readOptions(context);

    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (!isJsDoc(comment)) {
            continue;
          }
          const actual = proseLength(comment.value);
          if (actual > max) {
            context.report({ node: comment, messageId: 'excessive-prose', data: { actual, max } });
          }
        }
      }
    };
  }
};

export default rule;

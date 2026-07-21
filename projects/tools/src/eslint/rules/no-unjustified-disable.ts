/**
 * ESLint rule that requires every `eslint-disable*` directive comment to
 * carry a trailing `-- <reason>` justification (and, by default, an explicit
 * rule list rather than a blanket disable). Agents reach for `eslint-disable`
 * to get a green CI run; without a reason attached, a reviewer (human or
 * agent) has no way to tell a legitimate suppression from one hiding a real
 * bug, and a blanket disable silences rules nobody has looked at yet.
 */
import type { Rule } from 'eslint';
import type { Comment } from 'estree';

/** Shape of the (already schema-validated) options object, read defensively. */
interface RawOptions {
  readonly requireRuleIds?: boolean;
}

/** Resolved options after defaults have been applied. */
interface NoUnjustifiedDisableOptions {
  readonly requireRuleIds: boolean;
}

function readOptions(context: Rule.RuleContext): NoUnjustifiedDisableOptions {
  const provided = context.options[0] as RawOptions | undefined;
  return { requireRuleIds: provided?.requireRuleIds ?? true };
}

/**
 * Matches a comment that opens with one of the three ESLint directive
 * keywords (`eslint-disable`, `eslint-disable-line`, `eslint-disable-next-line`),
 * anchored so the keyword must be the very first thing in the (trimmed)
 * comment text and be followed by whitespace or end-of-text. This
 * deliberately excludes `eslint-enable` (not a suppression, nothing to
 * justify) and prose that merely mentions "eslint-disable" mid-sentence.
 */
const DIRECTIVE_KEYWORD_PATTERN = /^(eslint-disable-next-line|eslint-disable-line|eslint-disable)(?=\s|$)/;

/**
 * The `--` separator ESLint's own directive syntax uses to split the rule
 * list from the human-readable description, e.g.
 * `eslint-disable-next-line no-console -- reason`. Requires at least one
 * whitespace character before the dashes (so it can't misfire mid rule-id)
 * but is otherwise lenient about spacing around it.
 */
const JUSTIFICATION_SEPARATOR_PATTERN = /\s+--\s*/;

interface ParsedDirective {
  /** Trimmed text between the directive keyword and the `--` separator (empty if none found before it). */
  readonly rulePart: string;
  /** Trimmed text after the first `--` separator (empty if there was no separator, or nothing followed it). */
  readonly justification: string;
}

/** Parses a comment's raw text as a directive, or returns `null` if it isn't one. */
function parseDirective(commentText: string): ParsedDirective | null {
  const trimmedStart = commentText.replace(/^\s+/, '');
  const keywordMatch = DIRECTIVE_KEYWORD_PATTERN.exec(trimmedStart);
  if (!keywordMatch) {
    return null;
  }

  const rest = trimmedStart.slice(keywordMatch[0].length);
  const separatorMatch = JUSTIFICATION_SEPARATOR_PATTERN.exec(rest);
  if (!separatorMatch) {
    return { rulePart: rest.trim(), justification: '' };
  }

  const rulePart = rest.slice(0, separatorMatch.index).trim();
  const justification = rest.slice(separatorMatch.index + separatorMatch[0].length).trim();
  return { rulePart, justification };
}

function checkComment(context: Rule.RuleContext, comment: Comment, options: NoUnjustifiedDisableOptions): void {
  const parsed = parseDirective(comment.value);
  if (!parsed) {
    return;
  }

  if (parsed.justification === '') {
    context.report({ node: comment, messageId: 'missingJustification' });
  }
  if (options.requireRuleIds && parsed.rulePart === '') {
    context.report({ node: comment, messageId: 'missingRuleIds' });
  }
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Require eslint-disable directives to explain why, and (by default) which rules they target.',
      recommended: true
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          requireRuleIds: { type: 'boolean' }
        }
      }
    ],
    messages: {
      missingJustification: 'eslint-disable directives must explain why: append `-- <reason>`',
      missingRuleIds: 'Blanket eslint-disable hides unknown future violations; list the specific rules being disabled'
    }
  },
  create(context) {
    const options = readOptions(context);

    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          checkComment(context, comment, options);
        }
      }
    };
  }
};

export default rule;

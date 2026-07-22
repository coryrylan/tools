/**
 * Requires `eslint-disable*` directives to carry `-- <reason>` and, by
 * default, explicit rule ids: agents reach for `eslint-disable` for CI;
 * without a reason nobody can tell suppression from a hidden bug, and
 * blanket disables hide unreviewed rules.
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
 * Matches the ESLint directive keywords (`eslint-disable`, `-line`,
 * `-next-line`), anchored so the keyword opens the comment and is followed
 * by whitespace or end-of-text. Excludes `eslint-enable` and prose
 * mentioning eslint-disable mid-sentence.
 */
const DIRECTIVE_KEYWORD_PATTERN = /^(eslint-disable-next-line|eslint-disable-line|eslint-disable)(?=\s|$)/;

/**
 * The `--` separator ESLint's directive syntax uses to split rule list
 * from description, e.g. `eslint-disable-next-line no-console -- reason`.
 * Requires leading whitespace before the dashes so it can't misfire mid
 * rule-id; otherwise lenient on spacing.
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

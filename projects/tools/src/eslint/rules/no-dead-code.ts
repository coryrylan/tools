/**
 * Dead code snippets look load-bearing but aren't, wasting an agent's context.
 * Version control already remembers deleted code, so keeping it around is pure noise.
 *
 * @see https://kentcdodds.com/blog/please-dont-commit-commented-out-code
 */

import type { Rule } from 'eslint';
import type { Comment } from 'estree';

/** Options for the `no-dead-code` rule. */
export interface NoDeadCodeOptions {
  /** Regex source strings; a comment whose text matches any of these is never flagged. */
  readonly allowPatterns: readonly string[];
}

const DEFAULT_ALLOW_PATTERNS: readonly string[] = [];

/**
 * Comments that talk to tooling, not a reader - ESLint directives, TS pragmas,
 * Prettier's ignore marker, c8/istanbul markers - are never dead code regardless
 * of what follows the marker.
 */
const DIRECTIVE_COMMENT_PATTERN =
  /^(?:eslint-disable|eslint-enable|eslint-env|globals?\b|exported\b|@ts-|prettier-ignore|c8\b|istanbul\b)/;

/**
 * Heuristics for "this comment contains commented-out source code", ported from
 * the rule this replaces: each pattern targets one JS/TS construct common in real
 * code but rare in prose (see inline comments on patterns needing extra care).
 */
const CODE_LIKE_PATTERNS: Readonly<Record<string, RegExp>> = {
  importStatement: /\s*import\s+.*from\s+['"].*['"];/,
  exportStatement: /\s*export\s+.*from\s+['"].*['"];/,
  functionKeyword: /\bfunction\b\s+(\w+)\s*\(/,
  // A bare `word => word` reads as commented-out code, but prose also uses
  // "=>" as a mapping/notation arrow ("id => enabling config name",
  // "attr => property => default"). Real arrow-function code always carries
  // one of: parenthesized params (`(a, b) =>`), a single param immediately
  // preceded by a call/opening paren (`.map(x =>`) or an assignment
  // (`= x =>`), or a block/expression body immediately following the arrow
  // (`=> {`, `=> (`). A lone identifier arrow with only prose around it
  // matches none of these and is left alone.
  arrowFunction: /\([^()]*\)\s*=>|[(=]\s*\w+\s*=>|=>\s*[{(]/,
  variableDeclaration: /(?:^|\s)(?:const|let|var)\s+(\w+|\[.*\])\s*(?:[=,;]|$)/,
  // The bare-keyword ("$") branch only matches when the *entire* comment is
  // just the keyword (e.g. a lone `// for`) - not merely the last word of a
  // prose sentence. `if`/`for`/`do` are common English words too, and a
  // wrapped sentence that happens to end on one of them (e.g. "...counts as
  // pinned for") is not commented-out code.
  controlFlowKeyword: /\b(?:if|else|try|catch|switch|while|for|do)\b\s*\(|^(?:if|else|try|catch|switch|while|for|do)$/,
  returnStatement: /\breturn\b[^;]*;/,
  consoleLog: /\bconsole\s*\.?\s*log\b\s*\(/,
  debuggerStatement: /\bdebugger\b/,
  describeBlock: /\bdescribe\(/,
  itBlock: /\bit\(/
};

/** Whether `text` opens with a marker that tooling (not a human) reads. */
function isDirectiveComment(text: string): boolean {
  return DIRECTIVE_COMMENT_PATTERN.test(text);
}

/**
 * Strips markdown inline code spans before running the code heuristics. Prose
 * routinely names a construct for illustration (`` `it(...)` ``); real dead code
 * is never backtick-wrapped, so a backtick span is a doc reference, not
 * commented-out code.
 */
function stripInlineCodeSpans(text: string): string {
  return text.replace(/`[^`]*`/g, '');
}

/** Whether `text` matches any of the commented-out-code heuristics. */
function looksLikeCode(text: string): boolean {
  const withoutInlineCode = stripInlineCodeSpans(text);
  return Object.values(CODE_LIKE_PATTERNS).some(pattern => pattern.test(withoutInlineCode));
}

function matchesAnyPattern(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(text));
}

function readOptions(context: Rule.RuleContext): NoDeadCodeOptions {
  const provided = context.options[0] as Partial<NoDeadCodeOptions> | undefined;
  return { allowPatterns: provided?.allowPatterns ?? DEFAULT_ALLOW_PATTERNS };
}

/**
 * The JSON schema only validates `allowPatterns` as strings, so a malformed
 * regex source reaches here uncompiled. Skipping a pattern that fails to
 * compile keeps one bad option entry from crashing the entire lint run.
 */
function tryCompile(source: string): RegExp | null {
  try {
    return new RegExp(source);
  } catch {
    return null;
  }
}

function compileAllowPatterns(sources: readonly string[]): readonly RegExp[] {
  const patterns: RegExp[] = [];
  for (const source of sources) {
    const compiled = tryCompile(source);
    if (compiled !== null) {
      patterns.push(compiled);
    }
  }
  return patterns;
}

function shouldSkipComment(text: string, allowPatterns: readonly RegExp[]): boolean {
  return text === '' || isDirectiveComment(text) || matchesAnyPattern(text, allowPatterns);
}

function checkComment(context: Rule.RuleContext, comment: Comment, allowPatterns: readonly RegExp[]): void {
  const text = comment.value.trim();
  if (shouldSkipComment(text, allowPatterns) || !looksLikeCode(text)) {
    return;
  }

  context.report({
    node: comment,
    messageId: 'unexpected-dead-code',
    data: { type: comment.type.toLowerCase() }
  });
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow dead code paths or dead source-code comment blocks.'
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          allowPatterns: {
            type: 'array',
            items: { type: 'string' }
          }
        }
      }
    ],
    messages: {
      'unexpected-dead-code': 'Remove dead/commented {{type}} to avoid incorrect context.'
    }
  },
  create(context) {
    const options = readOptions(context);
    const allowPatterns = compileAllowPatterns(options.allowPatterns);

    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          checkComment(context, comment, allowPatterns);
        }
      }
    };
  }
};

export default rule;

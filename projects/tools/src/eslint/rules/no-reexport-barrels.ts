/**
 * ESLint rule that flags files re-exporting from more modules than
 * `maxReexports` allows. Agents follow barrel files (`export * from './x'`)
 * transitively - reading one barrel to find a symbol drags an entire
 * dependency closure into context. Deep barrels also block tree-shaking and
 * are a common source of import cycles.
 */
import type { Rule } from 'eslint';

/** Shape of the (already schema-validated) options object, read defensively. */
interface RawOptions {
  readonly maxReexports?: number;
  readonly allowNamed?: boolean;
}

/** Resolved options after defaults have been applied. */
interface NoReexportBarrelsOptions {
  readonly maxReexports: number;
  readonly allowNamed: boolean;
}

const DEFAULT_MAX_REEXPORTS = 5;

function readOptions(context: Rule.RuleContext): NoReexportBarrelsOptions {
  const provided = context.options[0] as RawOptions | undefined;
  return {
    maxReexports: provided?.maxReexports ?? DEFAULT_MAX_REEXPORTS,
    allowNamed: provided?.allowNamed ?? true
  };
}

type ExportAllDeclarationNode = Extract<Rule.Node, { type: 'ExportAllDeclaration' }>;
type ExportNamedDeclarationNode = Extract<Rule.Node, { type: 'ExportNamedDeclaration' }>;
type ReexportNode = ExportAllDeclarationNode | ExportNamedDeclarationNode;

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow re-exporting from more than a configured number of modules (barrel files).',
      recommended: true
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          maxReexports: { type: 'integer', minimum: 0 },
          allowNamed: { type: 'boolean' }
        }
      }
    ],
    messages: {
      tooManyReexports:
        'This file re-exports from {{count}} modules (max {{max}}). Barrel files bloat agent context and break tree-shaking; import from concrete modules instead.'
    }
  },
  create(context) {
    const options = readOptions(context);
    const reexports: ReexportNode[] = [];

    return {
      ExportAllDeclaration(node) {
        reexports.push(node);
      },
      ExportNamedDeclaration(node) {
        if (!options.allowNamed && node.source) {
          reexports.push(node);
        }
      },
      'Program:exit'() {
        if (reexports.length <= options.maxReexports) {
          return;
        }
        for (const node of reexports) {
          context.report({
            node,
            messageId: 'tooManyReexports',
            data: { count: reexports.length, max: options.maxReexports }
          });
        }
      }
    };
  }
};

export default rule;

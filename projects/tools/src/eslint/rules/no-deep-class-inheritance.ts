/**
 * Agents solve "need a slightly different X" by subclassing X instead of
 * composing; each layer makes sense alone but understanding one class means
 * reading the whole chain to its root. Counts superclass hops, reports once
 * a chain passes the max.
 */

import type { Rule } from 'eslint';
import type * as ts from 'typescript';

/** Options for the `no-deep-class-inheritance` rule. */
interface NoDeepClassInheritanceOptions {
  /** Maximum number of superclass hops allowed before an allowed root is reached. */
  readonly maxDepth: number;
  /** Class names that end the depth count early once reached. */
  readonly allowedRoots: readonly string[];
}

const DEFAULT_MAX_DEPTH = 2;
const DEFAULT_ALLOWED_ROOTS: readonly string[] = [];
const ANONYMOUS_CLASS_NAME = '<anonymous>';

/** The `ClassDeclaration` node shape ESLint passes into the rule's visitor. */
type ClassDeclarationNode = Extract<Rule.Node, { type: 'ClassDeclaration' }>;

/**
 * The slice of typescript-eslint's type-aware parser services this rule needs.
 * `parserServices` is typed `unknown`-ish by ESLint (varies per parser), so
 * this narrows it once at the boundary instead of an unchecked shape
 * flowing through the rule.
 */
interface TypeAwareParserServices {
  readonly program: ts.Program;
  readonly esTreeNodeToTSNodeMap: {
    get(node: object): ts.Node;
  };
}

function hasTypeAwareParserServices(services: unknown): services is TypeAwareParserServices {
  if (typeof services !== 'object' || services === null) {
    return false;
  }
  const candidate = services as Partial<TypeAwareParserServices>;
  return Boolean(candidate.program) && Boolean(candidate.esTreeNodeToTSNodeMap);
}

/** Returns `null` when the active parser doesn't provide type information (e.g. plain espree). */
function getTypeAwareParserServices(context: Rule.RuleContext): TypeAwareParserServices | null {
  const services: unknown = context.sourceCode.parserServices;
  return hasTypeAwareParserServices(services) ? services : null;
}

function readOptions(context: Rule.RuleContext): NoDeepClassInheritanceOptions {
  const provided = context.options[0] as Partial<NoDeepClassInheritanceOptions> | undefined;
  return {
    maxDepth: provided?.maxDepth ?? DEFAULT_MAX_DEPTH,
    allowedRoots: provided?.allowedRoots ?? DEFAULT_ALLOWED_ROOTS
  };
}

function getClassName(node: ClassDeclarationNode): string {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- `estree`'s `ClassDeclaration.id` is typed as always-defined, but `export default class extends Foo {}` really does produce a `ClassDeclaration` node with `id: null` at runtime (verified against espree/ESLint's own parser); the nullable typing only lives on `MaybeNamedClassDeclaration` (the type used for `ExportDefaultDeclaration.declaration`), not on the plain `ClassDeclaration` variant `Rule.Node` resolves to here. Removing the fallback would throw on that valid syntax.
  return node.id?.name ?? ANONYMOUS_CLASS_NAME;
}

/** The `extends` heritage clause of a class-like declaration, if it has one (as opposed to `implements`). */
function getExtendsExpression(classDeclaration: ts.ClassLikeDeclaration): ts.Expression | null {
  // Structural check instead of ts.SyntaxKind so the typescript package stays a
  // type-only import: the plugin must be loadable without typescript installed.
  const heritageClause = classDeclaration.heritageClauses?.find(clause => clause.getText().startsWith('extends'));
  return heritageClause?.types[0]?.expression ?? null;
}

/**
 * Structural stand-in for `ts.isClassLike`, again to keep typescript out of
 * the runtime import graph. Declaration merging can match an interface of the
 * same name; interfaces use `extends` clauses too, so chain walking still
 * terminates correctly.
 */
function isClassLikeDeclaration(declaration: ts.Declaration): declaration is ts.ClassLikeDeclaration {
  const candidate = declaration as Partial<ts.ClassLikeDeclaration>;
  return Array.isArray(candidate.members) && candidate.heritageClauses !== undefined;
}

/** The display name for one link in the inheritance chain: the resolved symbol's name, or the raw source text if it has none. */
function resolveClassName(symbol: ts.Symbol | undefined, expression: ts.Expression): string {
  return symbol?.getName() ?? expression.getText();
}

/**
 * The next superclass expression from `symbol`'s declaration, or `null` once
 * there's no further (or already-visited) class-like declaration to walk into.
 * Marks the declaration visited so `visited` stays accurate for the caller's
 * next iteration.
 */
function resolveNextExpression(
  symbol: ts.Symbol | undefined,
  visited: Set<ts.ClassLikeDeclaration>
): ts.Expression | null {
  const declaration = symbol?.declarations?.find(isClassLikeDeclaration);
  if (!declaration || visited.has(declaration)) {
    return null;
  }

  visited.add(declaration);
  return getExtendsExpression(declaration);
}

/**
 * Walks superclass hops from `superClass`, collecting each link's display
 * name until it runs out of resolvable declarations or hits a name in
 * `allowedRoots`. `visited` guards against revisiting a declaration if a
 * project's types ever formed a cycle.
 */
function getInheritanceChain(
  superClass: ts.Expression,
  checker: ts.TypeChecker,
  allowedRoots: ReadonlySet<string>
): string[] {
  const chain: string[] = [];
  const visited = new Set<ts.ClassLikeDeclaration>();
  let expression: ts.Expression | null = superClass;

  while (expression) {
    const symbol = checker.getTypeAtLocation(expression).getSymbol();
    const className = resolveClassName(symbol, expression);
    chain.push(className);

    if (allowedRoots.has(className)) {
      break;
    }

    expression = resolveNextExpression(symbol, visited);
  }

  return chain;
}

interface TooDeepReport {
  readonly node: ClassDeclarationNode;
  readonly chain: readonly string[];
  readonly maxDepth: number;
}

function reportTooDeep(context: Rule.RuleContext, report: TooDeepReport): void {
  const className = getClassName(report.node);
  context.report({
    node: report.node,
    messageId: 'too-deep',
    data: {
      className,
      depth: String(report.chain.length),
      maxDepth: String(report.maxDepth),
      chain: `${className} -> ${report.chain.join(' -> ')}`
    }
  });
}

interface CheckConfig {
  readonly maxDepth: number;
  readonly allowedRoots: ReadonlySet<string>;
}

function checkClassDeclaration(context: Rule.RuleContext, node: ClassDeclarationNode, config: CheckConfig): void {
  if (!node.superClass) {
    return;
  }

  const services = getTypeAwareParserServices(context);
  if (!services) {
    return;
  }

  // `node.superClass` is always an Expression by grammar (`extends <expr>`),
  // so the mapped TS node is too; the parser services API only gives us `ts.Node` back.
  const tsSuperClass = services.esTreeNodeToTSNodeMap.get(node.superClass) as ts.Expression;
  const checker = services.program.getTypeChecker();
  const chain = getInheritanceChain(tsSuperClass, checker, config.allowedRoots);

  if (chain.length <= config.maxDepth) {
    return;
  }

  reportTooDeep(context, { node, chain, maxDepth: config.maxDepth });
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow class inheritance chains deeper than the configured maximum.'
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          maxDepth: {
            type: 'integer',
            minimum: 1
          },
          allowedRoots: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true
          }
        }
      }
    ],
    messages: {
      'too-deep':
        '`{{className}}` has inheritance depth {{depth}} (`{{chain}}`). Maximum allowed depth is {{maxDepth}}.'
    }
  },
  create(context) {
    const options = readOptions(context);
    const config: CheckConfig = {
      maxDepth: options.maxDepth,
      allowedRoots: new Set(options.allowedRoots)
    };

    return {
      ClassDeclaration(node) {
        checkClassDeclaration(context, node, config);
      }
    };
  }
};

export default rule;

import { describe, expect, it } from 'vitest';
import type { Rule } from 'eslint';
import { findEnclosingClass, normalize, walk } from './utils.js';

/** Minimal AST-shaped fake node for exercising the helpers without a real parser. */
interface FakeNode {
  type: string;
  parent?: FakeNode | null;
  body?: FakeNode | FakeNode[];
  name?: string;
}

/** `utils.ts` types against `Rule.Node`; these tests build plain fixture objects instead. */
function asRuleNode(node: FakeNode): Rule.Node {
  return node as unknown as Rule.Node;
}

describe('walk', () => {
  it('visits every node in the tree, including nodes nested in arrays', () => {
    const leafA: FakeNode = { type: 'Identifier', name: 'a' };
    const leafB: FakeNode = { type: 'Identifier', name: 'b' };
    const block: FakeNode = { type: 'BlockStatement', body: [leafA, leafB] };
    const root: FakeNode = { type: 'Program', body: block };

    const visited: string[] = [];
    walk(root, node => visited.push(node.type));

    expect(visited).toEqual(['Program', 'BlockStatement', 'Identifier', 'Identifier']);
  });

  it('skips the `parent` back-pointer instead of recursing forever', () => {
    const root: FakeNode = { type: 'Program' };
    const child: FakeNode = { type: 'Identifier', name: 'x', parent: root };
    root.body = child;

    const visited: string[] = [];
    walk(root, node => visited.push(node.type));

    expect(visited).toEqual(['Program', 'Identifier']);
  });

  it('ignores non-node values and visits nothing', () => {
    const visited: string[] = [];
    walk(null, node => visited.push(node.type));
    walk(undefined, node => visited.push(node.type));
    walk('a string', node => visited.push(node.type));
    walk(42, node => visited.push(node.type));

    expect(visited).toEqual([]);
  });
});

describe('normalize', () => {
  it('collapses runs of whitespace into a single space', () => {
    expect(normalize('a    b\n\nc\t d')).toBe('a b c d');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalize('  \n hello world \n ')).toBe('hello world');
  });

  it('returns an already-normalized string unchanged', () => {
    expect(normalize('already normal')).toBe('already normal');
  });
});

describe('findEnclosingClass', () => {
  it('finds the nearest enclosing ClassDeclaration', () => {
    const program: FakeNode = { type: 'Program' };
    const classDecl: FakeNode = { type: 'ClassDeclaration', parent: program };
    const method: FakeNode = { type: 'MethodDefinition', parent: classDecl };
    const fn: FakeNode = { type: 'FunctionExpression', parent: method };
    const identifier: FakeNode = { type: 'Identifier', parent: fn };

    const found = findEnclosingClass(asRuleNode(identifier));

    expect(found?.type).toBe('ClassDeclaration');
    expect(found).toBe(classDecl as unknown as ReturnType<typeof findEnclosingClass>);
  });

  it('finds a ClassExpression just as well as a ClassDeclaration', () => {
    const program: FakeNode = { type: 'Program' };
    const classExpr: FakeNode = { type: 'ClassExpression', parent: program };
    const identifier: FakeNode = { type: 'Identifier', parent: classExpr };

    const found = findEnclosingClass(asRuleNode(identifier));

    expect(found?.type).toBe('ClassExpression');
  });

  it('returns null for a node at module scope', () => {
    const program: FakeNode = { type: 'Program' };
    const identifier: FakeNode = { type: 'Identifier', parent: program };

    expect(findEnclosingClass(asRuleNode(identifier))).toBeNull();
  });

  it('returns the innermost class when classes are nested', () => {
    const outer: FakeNode = { type: 'ClassDeclaration' };
    const inner: FakeNode = { type: 'ClassDeclaration', parent: outer };
    const identifier: FakeNode = { type: 'Identifier', parent: inner };

    const found = findEnclosingClass(asRuleNode(identifier));

    expect(found).not.toBe(outer as unknown as ReturnType<typeof findEnclosingClass>);
    expect(found?.type).toBe('ClassDeclaration');
  });
});

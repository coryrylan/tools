/**
 * Shared helpers for rules reasoning about AST shape (walking a subtree,
 * matching normalized text), lexical scope (enclosing class), or the
 * filesystem (listing/reading source files safely). Extracted so logic
 * stays consistent across `tools/*` rules.
 */

import { type Dirent, readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Rule } from 'eslint';

/**
 * A structural view of an AST node for generic traversal: every node has a
 * string `type` and may carry arbitrary child properties. Avoids committing
 * to a specific node union (ESTree vs. TypeScript-ESTree) so `walk` can
 * traverse any parser's tree.
 */
type AstNode = { readonly type: string } & Record<string, unknown>;

/** Narrows an unknown value to `AstNode` without asserting anything about it. */
function isAstNode(value: unknown): value is AstNode {
  return typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string';
}

/**
 * Recursively visits every node reachable from `node`, depth-first with no
 * further order guarantee. Skips the `parent` back-pointer (every node
 * points to its parent, so following it recurses forever) and descends into
 * child arrays and single nodes.
 */
export function walk(node: unknown, visit: (node: Rule.Node) => void): void {
  if (!isAstNode(node)) {
    return;
  }
  visit(node as unknown as Rule.Node);
  for (const key of Object.keys(node)) {
    if (key === 'parent') {
      continue;
    }
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        walk(item, visit);
      }
    } else if (isAstNode(child)) {
      walk(child, visit);
    }
  }
}

/** Collapses internal whitespace so multi-line source text matches regardless of formatting. */
export function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

type ClassNode = Extract<Rule.Node, { type: 'ClassDeclaration' | 'ClassExpression' }>;

/**
 * Walks up `.parent` looking for the nearest enclosing class. Returns `null`
 * when `node` lives at module scope (or otherwise outside any class body).
 */
export function findEnclosingClass(node: Rule.Node): ClassNode | null {
  let current: Rule.Node | null = node.parent;
  while (current) {
    if (current.type === 'ClassDeclaration' || current.type === 'ClassExpression') {
      return current;
    }
    current = current.parent;
  }
  return null;
}

/** Directories skipped by every recursive package-file listing, regardless of rule config. */
export const IMPLICIT_EXCLUDED_DIRS: readonly string[] = ['node_modules', 'dist'];

/**
 * TTL for {@link getPackageFiles}'s cache: long enough to amortize repeated
 * lookups per lint pass, short enough that a long-lived process (IDE server,
 * `eslint_d`, watch mode) reflects disk changes without a restart.
 */
export const FILE_CACHE_TTL_MS = 5000;

interface FileCacheEntry {
  readonly files: readonly string[];
  readonly cachedAtMs: number;
}

/** Recursive file listing per package root, cached for {@link FILE_CACHE_TTL_MS}. */
const FILE_CACHE = new Map<string, FileCacheEntry>();

/** Every file under `root`, recursively, excluding {@link IMPLICIT_EXCLUDED_DIRS}. Cached per root. */
export function getPackageFiles(root: string): readonly string[] {
  const key = normalizePath(root);
  const cached = FILE_CACHE.get(key);
  const now = Date.now();
  if (cached !== undefined && now - cached.cachedAtMs < FILE_CACHE_TTL_MS) {
    return cached.files;
  }
  const files = collectFilesSafe(key).map(normalizePath);
  FILE_CACHE.set(key, { files, cachedAtMs: now });
  return files;
}

function collectFilesSafe(dir: string): readonly string[] {
  return readDirSafe(dir).flatMap(entry => collectEntry(dir, entry));
}

function collectEntry(dir: string, entry: Dirent): readonly string[] {
  if (entry.isDirectory()) {
    return IMPLICIT_EXCLUDED_DIRS.includes(entry.name) ? [] : collectFilesSafe(join(dir, entry.name));
  }
  return entry.isFile() ? [join(dir, entry.name)] : [];
}

function readDirSafe(dir: string): readonly Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Reads `file` as UTF-8, or `null` when it doesn't exist or isn't readable. */
export function readFileSafe(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** Parses `text` as JSON, or `null` when it isn't valid JSON. */
export function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Converts a `file://` URL or OS-native path to a forward-slash path for cross-platform text matching. */
export function normalizePath(filepath: string): string {
  const asPath = filepath.startsWith('file://') ? fileURLToPath(filepath) : filepath;
  return asPath.replaceAll(sep, '/');
}

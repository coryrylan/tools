/// <reference types="node" />

/**
 * Flags an exported abstraction (an `abstract` class, or one whose name matches
 * a configured `Base…`/`…Base` pattern) with fewer than `minimumConsumers`
 * implementation consumers. Consumers are found by scanning sibling source
 * files on disk (cached per package root) and text-matching `extends` clauses,
 * resolving named/aliased/namespace/default imports and package barrel re-exports.
 */

import { existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import type { Rule } from 'eslint';
import { IMPLICIT_EXCLUDED_DIRS, getPackageFiles, normalizePath, readFileSafe, tryParseJson, walk } from './utils.js';

const DEFAULT_MINIMUM_CONSUMERS = 2;
const DEFAULT_INCLUDE: readonly string[] = ['src/**'];
const DEFAULT_NAME_PATTERNS: readonly string[] = ['^Base', 'Base$'];
const DEFAULT_EXTENSIONS: readonly string[] = ['.ts', '.tsx', '.js'];

/**
 * Equivalent specifier suffixes a consumer might use to import a `.ts` source
 * file: extensionless (bundler-resolution projects), `.js` (the NodeNext
 * "import the compiled output extension" convention), or `.ts`
 * (`allowImportingTsExtensions`).
 */
const TS_SPECIFIER_SUFFIXES: readonly string[] = ['', '.js', '.ts'];

/** {@link TS_SPECIFIER_SUFFIXES} plus the JSX-bearing equivalents `.tsx` sources may use. */
const TSX_SPECIFIER_SUFFIXES: readonly string[] = ['', '.js', '.ts', '.jsx', '.tsx'];

type ClassDeclarationNode = Extract<Rule.Node, { type: 'ClassDeclaration' }>;

interface NormalizedOptions {
  readonly minimumConsumers: number;
  readonly rootDir: string | null;
  readonly include: readonly RegExp[];
  readonly exclude: readonly RegExp[];
  readonly detectAbstract: boolean;
  readonly namePatterns: readonly RegExp[];
  readonly extensions: readonly string[];
}

interface CountArgs {
  readonly ast: unknown;
  readonly className: string;
  readonly defaultExported: boolean;
  readonly filename: string;
  readonly root: string;
  readonly options: NormalizedOptions;
}

interface ImportQuery {
  readonly className: string;
  readonly defaultExported: boolean;
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow abstractions (base classes) that have fewer than two implementation consumers.',
      recommended: true
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          minimumConsumers: { type: 'number', minimum: 2 },
          rootDir: { type: 'string' },
          include: { type: 'array', items: { type: 'string' } },
          exclude: { type: 'array', items: { type: 'string' } },
          detectAbstract: { type: 'boolean' },
          namePatterns: { type: 'array', items: { type: 'string' } },
          extensions: { type: 'array', items: { type: 'string' } }
        }
      }
    ],
    messages: {
      'single-consumer':
        'Abstraction "{{name}}" has {{count}} implementation consumer(s). Inline it into the consumer until at least {{minimum}} consumers need the abstraction.'
    }
  },
  create(context) {
    const filename = normalizePath(context.physicalFilename);
    const options = normalizeOptions(context.options[0]);
    const root = options.rootDir ?? findPackageRoot(filename);
    if (root === null || !shouldLint(filename, root, options)) {
      return {};
    }
    return {
      ClassDeclaration(node) {
        const className = getCandidateName(node, options);
        if (className === null) {
          return;
        }
        const defaultExported = isDefaultExported(node);
        const count = countConsumers({
          ast: context.sourceCode.ast,
          className,
          defaultExported,
          filename,
          root,
          options
        });
        if (count >= options.minimumConsumers) {
          return;
        }
        const data = { name: className, count: String(count), minimum: String(options.minimumConsumers) };
        context.report({ node, messageId: 'single-consumer', data });
      }
    };
  }
};

export default rule;

function normalizeOptions(raw: unknown): NormalizedOptions {
  const record = isRecord(raw) ? raw : {};
  return {
    minimumConsumers: readNumber(record['minimumConsumers'], DEFAULT_MINIMUM_CONSUMERS),
    rootDir: readOptionalRoot(record['rootDir']),
    include: readStringArray(record['include'], DEFAULT_INCLUDE).map(globToRegExp),
    exclude: readStringArray(record['exclude'], []).map(globToRegExp),
    detectAbstract: readBoolean(record['detectAbstract'], true),
    namePatterns: compilePatterns(readStringArray(record['namePatterns'], DEFAULT_NAME_PATTERNS)),
    extensions: readStringArray(record['extensions'], DEFAULT_EXTENSIONS)
  };
}

function readOptionalRoot(value: unknown): string | null {
  return isString(value) ? normalizePath(value) : null;
}

function compilePatterns(sources: readonly string[]): readonly RegExp[] {
  const patterns: RegExp[] = [];
  for (const source of sources) {
    const compiled = tryCompile(source);
    if (compiled !== null) {
      patterns.push(compiled);
    }
  }
  return patterns;
}

function tryCompile(source: string): RegExp | null {
  try {
    return new RegExp(source);
  } catch {
    return null;
  }
}

function getCandidateName(node: ClassDeclarationNode, options: NormalizedOptions): string | null {
  const name = getClassName(node);
  if (name === null || !isExported(node)) {
    return null;
  }
  if (options.detectAbstract && readProp(node, 'abstract') === true) {
    return name;
  }
  return options.namePatterns.some(pattern => pattern.test(name)) ? name : null;
}

function getClassName(node: ClassDeclarationNode): string | null {
  const name = readProp(readProp(node, 'id'), 'name');
  return isString(name) ? name : null;
}

function isExported(node: ClassDeclarationNode): boolean {
  const parentType = node.parent.type;
  return parentType === 'ExportNamedDeclaration' || parentType === 'ExportDefaultDeclaration';
}

function isDefaultExported(node: ClassDeclarationNode): boolean {
  return node.parent.type === 'ExportDefaultDeclaration';
}

function shouldLint(filename: string, root: string, options: NormalizedOptions): boolean {
  return isSourceFile(toRelativePath(root, filename), options);
}

function isSourceFile(relPath: string | null, options: NormalizedOptions): boolean {
  if (relPath === null || isInExcludedDir(relPath) || relPath.endsWith('.d.ts')) {
    return false;
  }
  if (!hasScannedExtension(relPath, options.extensions)) {
    return false;
  }
  return matchesAny(relPath, options.include) && !matchesAny(relPath, options.exclude);
}

function isInExcludedDir(relPath: string): boolean {
  return relPath.split('/').some(segment => IMPLICIT_EXCLUDED_DIRS.includes(segment));
}

function hasScannedExtension(relPath: string, extensions: readonly string[]): boolean {
  return extensions.some(extension => relPath.endsWith(extension));
}

function matchesAny(relPath: string, patterns: readonly RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(relPath));
}

function toRelativePath(root: string, file: string): string | null {
  const rel = normalizePath(relative(root, file));
  if (rel === '' || rel === '.' || rel === '..' || rel.startsWith('../')) {
    return null;
  }
  return rel;
}

function countConsumers(args: CountArgs): number {
  let consumers = countLocalSubclasses(args.ast, args.className);
  const barrels = getBarrelSpecifiers(args);
  for (const file of getSourceFiles(args.root, args.options)) {
    if (file !== args.filename) {
      consumers += countConsumersInFile(file, args, barrels);
    }
  }
  return consumers;
}

function countConsumersInFile(file: string, args: CountArgs, barrels: readonly string[]): number {
  const text = readFileSafe(file);
  if (text === null) {
    return 0;
  }
  const specifiers = relativeImportSpecifiers(file, args.filename);
  const names = new Set(
    importedNames(text, specifiers, { className: args.className, defaultExported: args.defaultExported })
  );
  for (const barrel of barrels) {
    for (const name of importedNames(text, [barrel], { className: args.className, defaultExported: false })) {
      names.add(name);
    }
  }
  return countSubclassMatches(text, [...names]);
}

function countLocalSubclasses(ast: unknown, className: string): number {
  let count = 0;
  walk(ast, node => {
    if (node.type === 'ClassDeclaration' && node.superClass && extendsClass(node.superClass, className)) {
      count += 1;
    }
  });
  return count;
}

function extendsClass(superClass: unknown, className: string): boolean {
  const type = readProp(superClass, 'type');
  if (type === 'Identifier') {
    return readProp(superClass, 'name') === className;
  }
  if (type === 'TSInstantiationExpression') {
    return extendsClass(readProp(superClass, 'expression'), className);
  }
  return false;
}

function countSubclassMatches(text: string, localNames: readonly string[]): number {
  if (localNames.length === 0) {
    return 0;
  }
  const alternation = localNames.map(escapeRegExp).join('|');
  // Lazy `[^{}]*?` skips the subclass's own type params even when they nest angle
  // brackets (`class A<T extends Map<string, number>> extends Base`); `[^>{}]*` didn't.
  const pattern = new RegExp(
    String.raw`\bclass\s+[A-Za-z_$][\w$]*(?:\s*<[^{}]*?>)?\s+extends\s+(?:${alternation})\b`,
    'g'
  );
  return [...text.matchAll(pattern)].length;
}

function importedNames(text: string, specifiers: readonly string[], query: ImportQuery): readonly string[] {
  const importMap = buildImportMap(text, specifiers);
  const names = new Set(importMap.get(query.className) ?? []);
  for (const namespace of importMap.get('*') ?? []) {
    names.add(`${namespace}.${query.className}`);
  }
  if (query.defaultExported) {
    for (const local of importMap.get('default') ?? []) {
      names.add(local);
    }
  }
  return [...names];
}

function buildImportMap(text: string, specifiers: readonly string[]): Map<string, Set<string>> {
  const imports = new Map<string, Set<string>>();
  const alternation = specifierAlternation(specifiers);
  const importPattern = new RegExp(String.raw`import\s+(?:type\s+)?([^;]*?)\s+from\s+['"](?:${alternation})['"]`, 'g');
  for (const match of text.matchAll(importPattern)) {
    const clause = (match[1] ?? '').trim();
    addDefaultImport(imports, clause);
    addNamespaceImport(imports, clause);
    addNamedImports(imports, clause);
  }
  return imports;
}

function addDefaultImport(imports: Map<string, Set<string>>, clause: string): void {
  if (clause === '' || clause.startsWith('{') || clause.startsWith('*')) {
    return;
  }
  const localName = (clause.split(/[,{]/)[0] ?? '').trim();
  if (isIdentifier(localName)) {
    addImport(imports, 'default', localName);
  }
}

function addNamespaceImport(imports: Map<string, Set<string>>, clause: string): void {
  const namespace = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/)?.[1];
  if (namespace !== undefined) {
    addImport(imports, '*', namespace);
  }
}

function addNamedImports(imports: Map<string, Set<string>>, clause: string): void {
  const named = clause.match(/{(?<imports>[\s\S]*?)}/)?.groups?.['imports'];
  if (named === undefined) {
    return;
  }
  for (const entry of named.split(',')) {
    addNamedEntry(imports, entry);
  }
}

function addNamedEntry(imports: Map<string, Set<string>>, entry: string): void {
  const normalized = entry.trim().replace(/^type\s+/, '');
  const match = normalized.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
  const exported = match?.[1];
  if (exported !== undefined) {
    addImport(imports, exported, match?.[2] ?? exported);
  }
}

function addImport(imports: Map<string, Set<string>>, exportedName: string, localName: string): void {
  const set = imports.get(exportedName) ?? new Set<string>();
  set.add(localName);
  imports.set(exportedName, set);
}

function getBarrelSpecifiers(args: CountArgs): readonly string[] {
  const packageName = readPackageName(args.root);
  if (packageName === null) {
    return [];
  }
  return barrelReExports(args) ? [packageName] : [];
}

function barrelReExports(args: CountArgs): boolean {
  for (const barrel of barrelCandidates(args.root, args.options)) {
    const text = readFileSafe(barrel);
    if (text !== null && reExportsClass(text, args.className, relativeImportSpecifiers(barrel, args.filename))) {
      return true;
    }
  }
  return false;
}

function barrelCandidates(root: string, options: NormalizedOptions): readonly string[] {
  const candidates: string[] = [];
  for (const extension of options.extensions) {
    candidates.push(normalizePath(join(root, 'src', `index${extension}`)));
    candidates.push(normalizePath(join(root, `index${extension}`)));
  }
  return candidates;
}

function reExportsClass(text: string, className: string, specifiers: readonly string[]): boolean {
  const alternation = specifierAlternation(specifiers);
  const starPattern = new RegExp(String.raw`export\s+\*\s+from\s+['"](?:${alternation})['"]`, 'm');
  const namedPattern = new RegExp(
    String.raw`export\s+{[^}]*\b${escapeRegExp(className)}\b[^}]*}\s+from\s+['"](?:${alternation})['"]`,
    'm'
  );
  return starPattern.test(text) || namedPattern.test(text);
}

function getSourceFiles(root: string, options: NormalizedOptions): readonly string[] {
  return getPackageFiles(root).filter(file => isSourceFile(toRelativePath(root, file), options));
}

function readPackageName(root: string): string | null {
  const text = readFileSafe(join(root, 'package.json'));
  if (text === null) {
    return null;
  }
  const name = readProp(tryParseJson(text), 'name');
  return isString(name) ? name : null;
}

function findPackageRoot(filename: string): string | null {
  let current = dirname(filename);
  while (current !== dirname(current)) {
    if (existsSync(join(current, 'package.json')) && existsSync(join(current, 'src'))) {
      return normalizePath(current);
    }
    current = dirname(current);
  }
  return null;
}

/**
 * Every specifier a consumer could plausibly use to import `toFile` from
 * `fromFile`: extensionless, `.js`, `.ts`, and - when `toFile` is a `.tsx`
 * source - the JSX-bearing equivalents too. Text-matching imports can't know
 * which module resolution convention a given consumer file follows, so every
 * candidate is checked instead of assuming one.
 */
function relativeImportSpecifiers(fromFile: string, toFile: string): readonly string[] {
  const fromDir = fromFile.slice(0, fromFile.lastIndexOf('/'));
  const extensionless = toFile.replace(/\.tsx?$/, '');
  const relativeBase = normalizePath(relative(fromDir, extensionless));
  const specifierBase = relativeBase.startsWith('.') ? relativeBase : `./${relativeBase}`;
  const suffixes = toFile.endsWith('.tsx') ? TSX_SPECIFIER_SUFFIXES : TS_SPECIFIER_SUFFIXES;
  return suffixes.map(suffix => `${specifierBase}${suffix}`);
}

function specifierAlternation(specifiers: readonly string[]): string {
  return specifiers.map(escapeRegExp).join('|');
}

function globToRegExp(glob: string): RegExp {
  const normalized = glob.replaceAll(sep, '/');
  const parts: string[] = [];
  let index = 0;
  while (index < normalized.length) {
    index = appendGlobToken(normalized, index, parts);
  }
  return new RegExp(`^${parts.join('')}$`);
}

function appendGlobToken(glob: string, index: number, parts: string[]): number {
  const char = glob[index] ?? '';
  if (char === '*' && glob[index + 1] === '*') {
    return appendGlobstar(glob, index, parts);
  }
  if (char === '*') {
    parts.push('[^/]*');
  } else if (char === '?') {
    parts.push('[^/]');
  } else {
    parts.push(escapeRegExp(char));
  }
  return index + 1;
}

function appendGlobstar(glob: string, index: number, parts: string[]): number {
  if (glob[index + 2] === '/') {
    parts.push('(?:[^/]*/)*');
    return index + 3;
  }
  parts.push('.*');
  return index + 2;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function isString(value: unknown): value is string {
  return typeof value === 'string';
}
function readProp(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}
function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}
function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}
function readStringArray(value: unknown, fallback: readonly string[]): readonly string[] {
  return Array.isArray(value) ? value.filter(isString) : fallback;
}
function isIdentifier(value: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(value);
}
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

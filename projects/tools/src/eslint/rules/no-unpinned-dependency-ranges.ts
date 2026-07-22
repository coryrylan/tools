/**
 * Enforces package.json version rules for reproducible installs: private
 * packages pin exact versions; published runtime deps need a range for
 * dedupe, devDependencies stay pinned. Catches agents defaulting to the
 * wrong specifier for publish status.
 */

import type { JSONRuleDefinition } from '@eslint/json';

interface NoUnpinnedDependencyRangesOptions {
  /**
   * Whether pnpm's `catalog:` protocol is accepted unconditionally,
   * bypassing pinned/range checks. Defaults to `true`; set `false` to make
   * `catalog:` specifiers follow the same rules as any other version
   * string.
   */
  readonly allowCatalog?: boolean;
}

type NoUnpinnedDependencyRangesRuleOptions = [NoUnpinnedDependencyRangesOptions?];
type NoUnpinnedDependencyRangesMessageIds = 'unpinned-range';

export type NoUnpinnedDependencyRangesRuleDefinition = JSONRuleDefinition<{
  RuleOptions: NoUnpinnedDependencyRangesRuleOptions;
  MessageIds: NoUnpinnedDependencyRangesMessageIds;
}>;

const DEPENDENCY_GROUPS = new Set(['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']);
const RUNTIME_DEPENDENCY_GROUPS = new Set(['dependencies', 'peerDependencies', 'optionalDependencies']);

/**
 * Matches specifiers resolving to more than one version: caret/tilde,
 * comparators (`>=9`), unions (`^9 || ^10`), hyphen ranges (`1.2 - 2`),
 * wildcards (`*`, `1.x`). `workspace:*`/`catalog:` deliberately don't
 * match; handled by their own branches.
 */
const VERSION_RANGE_PATTERN = /^[\^~]|^[<>]=?\s*\d|\|\||\s-\s|^(?:\d+(?:\.\d+)?\.)?[x*]$/;

function isVersionRange(version: string): boolean {
  return VERSION_RANGE_PATTERN.test(version);
}

interface DependencyContext {
  readonly isPrivate: boolean;
  readonly isRuntime: boolean;
  readonly version: string;
}

/** Returns a human-readable reason the version specifier is invalid, or `null` if it's fine. */
function reasonForDependency({ isPrivate, isRuntime, version }: DependencyContext): string | null {
  if (isPrivate) {
    return isVersionRange(version)
      ? 'Private packages must use pinned versions to ensure reproducible installs.'
      : null;
  }
  if (isRuntime) {
    const hasRange = isVersionRange(version) || (version.startsWith('workspace:') && version !== 'workspace:*');
    return hasRange
      ? null
      : 'Published runtime dependencies must use a range specifier (^, ~, or a comparator such as >=) for downstream deduplication.';
  }
  return isVersionRange(version)
    ? 'Published devDependencies must use pinned versions for reproducible installs.'
    : null;
}

const rule: NoUnpinnedDependencyRangesRuleDefinition = {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Require package.json dependency version specifiers appropriate to the package's publish status (private vs. published) and dependency kind (runtime vs. dev)."
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowCatalog: { type: 'boolean', default: true }
        },
        additionalProperties: false
      }
    ],
    messages: {
      'unpinned-range': 'Dependency "{{name}}" has an invalid version specifier "{{version}}". {{reason}}'
    }
  },
  create(context) {
    const allowCatalog = context.options[0]?.allowCatalog ?? true;

    return {
      Document(node) {
        const root = node.body;
        if (root.type !== 'Object') return;

        const isPrivate = root.members.some(
          member =>
            member.name.type === 'String' &&
            member.name.value === 'private' &&
            member.value.type === 'Boolean' &&
            member.value.value
        );

        root.members.forEach(member => {
          if (
            member.name.type !== 'String' ||
            !DEPENDENCY_GROUPS.has(member.name.value) ||
            member.value.type !== 'Object'
          ) {
            return;
          }
          const isRuntime = RUNTIME_DEPENDENCY_GROUPS.has(member.name.value);

          member.value.members.forEach(dep => {
            if (dep.name.type !== 'String' || dep.value.type !== 'String') return;

            const name = dep.name.value;
            const version = dep.value.value;
            if (allowCatalog && version.startsWith('catalog:')) return;

            const reason = reasonForDependency({ isPrivate, isRuntime, version });
            if (!reason) return;

            context.report({
              loc: dep.value.loc,
              messageId: 'unpinned-range',
              data: { name, version, reason }
            });
          });
        });
      }
    };
  }
};

export default rule;

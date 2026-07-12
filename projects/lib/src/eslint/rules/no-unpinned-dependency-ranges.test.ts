import { describe, expect, it } from 'vitest';
import { RuleTester } from 'eslint';
import json from '@eslint/json';
import noUnpinnedDependencyRanges from './no-unpinned-dependency-ranges.js';

/**
 * NOTE: `RuleTester.run()` detects Vitest's global `describe`/`it` (enabled
 * via `globals: true`) and uses them to register its own per-case tests, so
 * `.run(...)` must be called directly inside a `describe` block rather than
 * wrapped in an extra `it(...)` - nesting a suite call inside a test throws.
 */

const tester = new RuleTester({
  plugins: { json },
  language: 'json/json'
});

describe('meta', () => {
  it('defines rule metadata', () => {
    expect(noUnpinnedDependencyRanges.meta?.type).toBe('problem');
    expect(noUnpinnedDependencyRanges.meta?.messages?.['unpinned-range']).toBeTruthy();
  });
});

describe('private packages', () => {
  tester.run('no-unpinned-dependency-ranges', noUnpinnedDependencyRanges, {
    valid: [
      // Pinned versions are required for every dependency group.
      { filename: 'package.json', code: '{ "private": true, "dependencies": { "foo": "1.2.3" } }' },
      { filename: 'package.json', code: '{ "private": true, "devDependencies": { "foo": "1.2.3" } }' },
      { filename: 'package.json', code: '{ "private": true, "peerDependencies": { "foo": "1.2.3" } }' },
      { filename: 'package.json', code: '{ "private": true, "optionalDependencies": { "foo": "1.2.3" } }' },
      // workspace:* links and catalog: references also resolve to a concrete version.
      { filename: 'package.json', code: '{ "private": true, "devDependencies": { "foo": "workspace:*" } }' },
      { filename: 'package.json', code: '{ "private": true, "dependencies": { "foo": "catalog:" } }' }
    ],
    invalid: [
      // Ranges are never allowed, regardless of dependency group.
      {
        filename: 'package.json',
        code: '{ "private": true, "dependencies": { "foo": "^1.2.3" } }',
        errors: [{ messageId: 'unpinned-range' }]
      },
      {
        filename: 'package.json',
        code: '{ "private": true, "devDependencies": { "foo": "~1.2.3" } }',
        errors: [{ messageId: 'unpinned-range' }]
      },
      {
        filename: 'package.json',
        code: '{ "private": true, "peerDependencies": { "foo": "^1.2.3" } }',
        errors: [{ messageId: 'unpinned-range' }]
      },
      {
        filename: 'package.json',
        code: '{ "private": true, "optionalDependencies": { "foo": "~1.2.3" } }',
        errors: [{ messageId: 'unpinned-range' }]
      },
      // Comparator and wildcard ranges are just as unreproducible as ^/~.
      {
        filename: 'package.json',
        code: '{ "private": true, "dependencies": { "foo": ">=1" } }',
        errors: [{ messageId: 'unpinned-range' }]
      },
      {
        filename: 'package.json',
        code: '{ "private": true, "devDependencies": { "foo": "1.x" } }',
        errors: [{ messageId: 'unpinned-range' }]
      }
    ]
  });
});

describe('published packages', () => {
  tester.run('no-unpinned-dependency-ranges', noUnpinnedDependencyRanges, {
    valid: [
      // devDependencies never reach consumers, so they must stay pinned.
      { filename: 'package.json', code: '{ "name": "@acme/example", "devDependencies": { "foo": "1.2.3" } }' },
      // Runtime dependencies need a range so downstream consumers can dedupe.
      { filename: 'package.json', code: '{ "dependencies": { "foo": "~1.2.3" } }' },
      { filename: 'package.json', code: '{ "dependencies": { "foo": "^1.2.3" } }' },
      { filename: 'package.json', code: '{ "peerDependencies": { "foo": "~1.2.3" } }' },
      { filename: 'package.json', code: '{ "peerDependencies": { "foo": "^1.2.3" } }' },
      { filename: 'package.json', code: '{ "optionalDependencies": { "foo": "~1.2.3" } }' },
      { filename: 'package.json', code: '{ "optionalDependencies": { "foo": "^1.2.3" } }' },
      // catalog:publish is accepted unconditionally regardless of dependency kind.
      { filename: 'package.json', code: '{ "dependencies": { "foo": "catalog:publish" } }' },
      { filename: 'package.json', code: '{ "peerDependencies": { "foo": "catalog:publish" } }' },
      { filename: 'package.json', code: '{ "optionalDependencies": { "foo": "catalog:publish" } }' },
      { filename: 'package.json', code: '{ "devDependencies": { "foo": "catalog:publish" } }' },
      // A concrete workspace: range also satisfies the runtime "needs a range" check.
      { filename: 'package.json', code: '{ "dependencies": { "foo": "workspace:^" } }' },
      { filename: 'package.json', code: '{ "peerDependencies": { "foo": "workspace:^" } }' },
      { filename: 'package.json', code: '{ "optionalDependencies": { "foo": "workspace:^" } }' },
      // Comparator, union, hyphen, and wildcard ranges dedupe just as well as ^/~.
      { filename: 'package.json', code: '{ "peerDependencies": { "eslint": ">=9" } }' },
      { filename: 'package.json', code: '{ "peerDependencies": { "typescript": ">=5.5.0 <6.1.0" } }' },
      { filename: 'package.json', code: '{ "peerDependencies": { "foo": "^9 || ^10" } }' },
      { filename: 'package.json', code: '{ "dependencies": { "foo": "1.2 - 2" } }' },
      { filename: 'package.json', code: '{ "dependencies": { "foo": "1.2.x" } }' },
      { filename: 'package.json', code: '{ "dependencies": { "foo": "*" } }' }
    ],
    invalid: [
      // Pinned runtime dependencies prevent consumers from deduplicating.
      {
        filename: 'package.json',
        code: '{ "name": "@acme/example", "dependencies": { "foo": "1.2.3" } }',
        errors: [{ messageId: 'unpinned-range' }]
      },
      {
        filename: 'package.json',
        code: '{ "name": "@acme/example", "peerDependencies": { "foo": "1.2.3" } }',
        errors: [{ messageId: 'unpinned-range' }]
      },
      // Unpinned devDependencies are never allowed.
      {
        filename: 'package.json',
        code: '{ "name": "@acme/example", "devDependencies": { "foo": "^1.2.3" } }',
        errors: [{ messageId: 'unpinned-range' }]
      },
      {
        filename: 'package.json',
        code: '{ "name": "@acme/example", "devDependencies": { "foo": "~1.2.3" } }',
        errors: [{ messageId: 'unpinned-range' }]
      },
      // workspace:* is an undefined range for a published runtime dependency.
      {
        filename: 'package.json',
        code: '{ "dependencies": { "foo": "workspace:*" } }',
        errors: [{ messageId: 'unpinned-range' }]
      },
      {
        filename: 'package.json',
        code: '{ "peerDependencies": { "foo": "workspace:*" } }',
        errors: [{ messageId: 'unpinned-range' }]
      },
      {
        filename: 'package.json',
        code: '{ "optionalDependencies": { "foo": "workspace:*" } }',
        errors: [{ messageId: 'unpinned-range' }]
      }
    ]
  });
});

describe('allowCatalog option', () => {
  tester.run('no-unpinned-dependency-ranges', noUnpinnedDependencyRanges, {
    valid: [
      // Default (true): any catalog: specifier is accepted unconditionally.
      { filename: 'package.json', code: '{ "private": true, "dependencies": { "foo": "catalog:" } }', options: [{}] },
      {
        filename: 'package.json',
        code: '{ "dependencies": { "foo": "catalog:publish" } }',
        options: [{ allowCatalog: true }]
      },
      // false: "catalog:" isn't a ^/~ range, so it still counts as "pinned" for
      // a private dependency and doesn't trip the devDependency pinning check.
      {
        filename: 'package.json',
        code: '{ "private": true, "dependencies": { "foo": "catalog:" } }',
        options: [{ allowCatalog: false }]
      },
      {
        filename: 'package.json',
        code: '{ "name": "@acme/example", "devDependencies": { "foo": "catalog:publish" } }',
        options: [{ allowCatalog: false }]
      }
    ],
    invalid: [
      // false: "catalog:publish" is also not a range, so it no longer satisfies
      // a published runtime dependency's "must use ^, ~, or workspace:" requirement.
      {
        filename: 'package.json',
        code: '{ "dependencies": { "foo": "catalog:publish" } }',
        options: [{ allowCatalog: false }],
        errors: [{ messageId: 'unpinned-range' }]
      }
    ]
  });
});

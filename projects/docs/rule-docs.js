// Loads the per-rule markdown docs that live in the @coryrylan/tools
// package itself (projects/lib/src/eslint/docs/rules/*.md - the source of
// truth for rule behavior) and derives, from the built plugin's own rule
// registry and config exports, which config(s) enable each rule by default.
// Consumed by eleventy.config.js to generate the rule pages, the rules
// index, and llms.txt as Eleventy virtual templates.

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import agentLintRules from '@coryrylan/tools/eslint';
import { extractSummary, validateIdsMatch } from './doc-utils.js';

const docsRoot = fileURLToPath(new URL('.', import.meta.url));
const ruleDocsDir = resolve(docsRoot, '../lib/src/eslint/docs/rules');
const TOOLS_RULE_PREFIX = 'tools/';

/** Whether a flat-config rule entry (a bare severity, or `[severity, ...options]`) turns the rule on. */
function isRuleEntryEnabled(ruleEntry) {
  const severity = Array.isArray(ruleEntry) ? ruleEntry[0] : ruleEntry;
  return severity !== 'off' && severity !== 0;
}

/** The `tools/*` rule ids (without the `tools/` prefix) one exported flat-config array enables. */
function getEnabledAgentsRuleIds(config) {
  const ruleIds = new Set();
  for (const configEntry of config) {
    for (const [ruleId, ruleEntry] of Object.entries(configEntry.rules ?? {})) {
      if (ruleId.startsWith(TOOLS_RULE_PREFIX) && isRuleEntryEnabled(ruleEntry)) {
        ruleIds.add(ruleId.slice(TOOLS_RULE_PREFIX.length));
      }
    }
  }
  return ruleIds;
}

/**
 * Which exported config(s) enable each `tools/*` rule by default, computed
 * from the built library's own plugin registry and config exports instead of
 * a hand-maintained mirror - a rule moving between configs (or a new config
 * being added) shows up here automatically instead of silently drifting out
 * of the published site. A rule mapped to an empty array ships registered
 * but off by default (opt-in only).
 */
function deriveRuleConfigs({ plugin, configs }) {
  const ruleConfigs = new Map(Object.keys(plugin.rules).map(ruleId => [ruleId, []]));
  for (const [configName, config] of Object.entries(configs)) {
    for (const ruleId of getEnabledAgentsRuleIds(config)) {
      ruleConfigs.get(ruleId)?.push(configName);
    }
  }
  return ruleConfigs;
}

function ruleIdFromFilename(filename) {
  return filename.replace(/\.md$/, '');
}

/** Every `tools/*` rule doc, validated against the plugin registry and sorted by id. */
export function loadRules() {
  const ruleConfigs = deriveRuleConfigs(agentLintRules);
  const files = readdirSync(ruleDocsDir).filter(name => name.endsWith('.md') && name !== 'README.md');

  // Fails the build the moment the plugin's rule registry and the doc files
  // under ruleDocsDir disagree, in either direction: a rule registered in
  // plugin.ts with no doc would otherwise publish silently undocumented, and
  // a leftover doc for a removed/renamed rule would otherwise publish a dead
  // page nothing links to.
  const docRuleIds = files.map(ruleIdFromFilename);
  validateIdsMatch([...ruleConfigs.keys()], docRuleIds, {
    orphanedMessage: ids =>
      `Rule doc(s) with no corresponding registered rule in plugin.ts: ${ids.map(id => `${id}.md`).join(', ')}. Remove the stale doc, or register the rule in projects/lib/src/eslint/plugin.ts.`,
    missingMessage: ids =>
      `Rule(s) registered in plugin.ts with no doc file under ${ruleDocsDir}: ${ids.join(', ')}. Add "<rule-id>.md" so the docs site stays in sync with the registered ruleset.`
  });

  return files
    .map(file => {
      const id = ruleIdFromFilename(file);
      const markdown = readFileSync(join(ruleDocsDir, file), 'utf8');
      return {
        id,
        summary: extractSummary(markdown, { expectedHeading: `# tools/${id}`, docLabel: `rule doc ${file}` }),
        configs: ruleConfigs.get(id) ?? [],
        markdown
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

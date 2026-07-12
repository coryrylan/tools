// Loads the per-surface markdown docs that live in the @coryrylan/tools
// package itself (projects/lib/src/<surface>/docs/index.md - the source of
// truth for each tool surface: eslint, prettier, stylelint, vale, vite,
// vitest) and validates them against the package's own exports map so the
// published site can never drift from what the package actually ships.
// Consumed by eleventy.config.js to generate one page per surface and the
// surface section of llms.txt as Eleventy virtual templates.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractSummary, validateIdsMatch } from './doc-utils.js';

const docsRoot = fileURLToPath(new URL('.', import.meta.url));
const libRoot = resolve(docsRoot, '../lib');

/**
 * Vale is a directory of shipped assets (ini template + vocabulary), not a
 * JS entry in the exports map, so it is appended to the export-derived
 * surface list by hand.
 */
const ASSET_SURFACES = ['vale'];

/** First path segment of an exports-map key: './vite/plugins/dts' -> 'vite'. */
function surfaceIdFromExportKey(exportKey) {
  return exportKey.replace(/^\.\//, '').split('/')[0];
}

/** The surface ids the lib's package.json exports map commits to shipping. */
function getExportedSurfaceIds() {
  const packageJson = JSON.parse(readFileSync(join(libRoot, 'package.json'), 'utf8'));
  const ids = Object.keys(packageJson.exports)
    .filter(exportKey => exportKey !== '.' && exportKey !== './package.json')
    .map(surfaceIdFromExportKey);
  return [...new Set([...ids, ...ASSET_SURFACES])].sort();
}

/** The surface ids that have a docs page on disk under src/<id>/docs/index.md. */
function getDocumentedSurfaceIds() {
  return readdirSync(join(libRoot, 'src'), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join(libRoot, 'src', entry.name, 'docs', 'index.md')))
    .map(entry => entry.name)
    .sort();
}

/** Every tool surface the package ships, validated against the exports map and sorted by id. */
export function loadSurfaces() {
  const exportedIds = getExportedSurfaceIds();
  const documentedIds = getDocumentedSurfaceIds();

  // Fails the build the moment the exports map and the surface docs disagree,
  // in either direction: an exported surface with no doc would publish
  // silently undocumented, and a leftover doc for a removed surface would
  // publish a dead page nothing links to.
  validateIdsMatch(exportedIds, documentedIds, {
    missingMessage: ids =>
      `Exported surface(s) with no docs page: ${ids.join(', ')}. Add projects/lib/src/<surface>/docs/index.md so every shipped surface is documented.`,
    orphanedMessage: ids =>
      `Surface docs page(s) with no exports-map entry: ${ids.join(', ')}. Remove the stale docs, or add the surface to projects/lib/package.json#exports (asset-only surfaces belong in ASSET_SURFACES instead).`
  });

  return exportedIds.map(id => {
    const markdown = readFileSync(join(libRoot, 'src', id, 'docs', 'index.md'), 'utf8');
    return {
      id,
      summary: extractSummary(markdown, { expectedHeading: `# ${id}`, docLabel: `${id} surface doc` }),
      markdown
    };
  });
}

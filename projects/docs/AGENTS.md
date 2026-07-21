# docs - Elements + Eleventy integration

This file only covers how `projects/docs` wires Elements into Eleventy and how the site's content is generated. For component APIs, template validation, and project setup commands, use the Elements CLI/MCP documentation instead.

## Integration Points

- Keep global Elements CSS in `src/_layouts/index.css`.
- Register Elements used by layout or markdown content in `src/_layouts/index.ts`.
- Keep shared page shell markup in `src/_layouts/index.11ty.js`; page files should supply content.
- Use `@11ty/eleventy-plugin-vite` for bundling the layout entrypoint.

## Markdown Rendering

- Add `nve-text` and `nve-layout` attributes through the markdown-it renderer in `eleventy.config.js` when markdown should receive Elements typography.
- Keep renderer mappings constrained to token types that markdown-it exposes predictably: headings, paragraphs, links, lists, inline code, fences, and tables.
- Inline code spans (single backticks) get `nve-text="code"` - a bare `<code>` fails the Elements template validator's unstyled-typography check.
- Fenced code blocks (` ``` `) render as `nve-codeblock`, not `<pre>`. The fence info string maps to the `language` attribute (aliased where markdown shorthand differs, e.g. `sh` → `bash`, `ts` → `typescript`, `jsonc` → `json`); unrecognized or absent languages omit the attribute and fall back to the component's default.
- Pipe tables render as `nve-grid` (`nve-grid-header`/`-column`/`-row`/`-cell`), not `<table>`. There is no scroll wrapper around the grid - wide tables rely on the grid's own layout. Each cell's inline content is wrapped in a `<span>` because `nve-grid-cell`'s shadow DOM slots into a flex container, which blockifies bare direct children.
- Let raw `nve-*` HTML pass through markdown only when the page intentionally owns that markup - markdown-it runs with `html: true` for exactly this.

## Routing

- Keep the `<base>` URL and Vite `base` aligned with `PAGES_BASE_URL` (defaults to `/` when unset - no hardcoded path suffix).
- Use base-relative links everywhere in navigation and content markup (`eslint/`, `eslint/rules/<id>/`), never page-relative (`<id>/`) and never with a leading slash - the layout's `<base href>` resolves them against `PAGES_BASE_URL`, so a leading `/` or a page-relative path breaks under a non-root base.

## Generated pages

Unlike the cradle docs this was forked from, this site's rule pages are not hand-authored `src/**/index.md` files - they're Eleventy virtual templates built at build time by `rule-docs.js` and registered in `eleventy.config.js`:

- `rule-docs.js` exports `loadRules()`, which reads every `../tools/src/eslint/docs/rules/*.md` file (excluding `README.md`) - the source of truth for rule behavior, owned by the `lib` package, not this one - and derives which exported config (`recommended`, `strict`, `typescript`, `tests`, `json`, `browser`) enables each rule by inspecting the built plugin's own rule registry and config exports (`import agentLintRules from '@coryrylan/tools/eslint'`). This mapping is computed, never hand-maintained, so a rule moving between configs shows up on the site automatically.
- `loadRules()` fails the build the instant the doc files and the plugin's registered rules disagree in either direction: a registered rule with no doc, or a doc with no registered rule. This drift guard is the reason `build` depends on `../tools:test` and `../tools:lint` - the lib package must be built before `rule-docs.js` can import its plugin.
- `eleventy.config.js` turns each `loadRules()` entry into an `eslint/rules/<id>.md` virtual template (via `addTemplate`), prefixed with a base-relative breadcrumb link and `nve-badge` config indicators; the generated pipe table of every rule is spliced into the eslint surface page at its `<!-- agents-rules-catalog -->` marker, and the build fails if the marker is missing.
- `doc-utils.js` holds the `extractSummary`/`validateIdsMatch` helpers shared by `rule-docs.js` and `surface-docs.js`: every doc must open with an exact heading (`# tools/<id>` for rules, `# <id>` for surfaces) followed by a one-line summary, and both loaders throw on any id-set drift between the source of truth and the docs on disk.
- The layout's nav is derived, not hand-kept: `eleventy.config.js` publishes the `loadSurfaces()` ids via `eleventyConfig.addGlobalData('surfaces', ...)` and `index.11ty.js` builds the menu from `data.surfaces`, owning only display-label overrides (`SURFACE_LABELS`).
- `llms.txt` is a virtual template permalinked under `public/llms.txt`, not `llms.txt` directly. The Vite build step renames the entire 11ty output directory aside and rebuilds it from only the HTML/CSS/JS asset graph, discarding anything else that was in it - including a plain-text file written by an `eleventy.after` hook, since 11ty runs `eleventy.after` listeners in parallel and the directory rename can win the race against a later write. Vite's `publicDir` convention (default `public/`) is the one thing it copies into the rebuilt output verbatim, so routing the virtual template through it is what makes `llms.txt` survive the rebuild.

## Verification

- Run `pnpm -F docs run build` after layout, renderer, rule-doc, or asset pipeline changes.
- Run `pnpm -F docs run lint` when editing Eleventy config, `rule-docs.js`, or layout TypeScript.
- From the repo root, `pnpm run ci` runs every project's `lint` + `build`, including this one.

import { EleventyRenderPlugin } from '@11ty/eleventy';
import EleventyPluginVite from '@11ty/eleventy-plugin-vite';
import markdownIt from 'markdown-it';
import { loadRules } from './rule-docs.js';
import { loadSurfaces } from './surface-docs.js';

const BASE_URL = process.env.PAGES_BASE_URL ?? '/';
const SITE_URL = 'https://coryrylan.github.io/tools/';
const OUTPUT_DIR = 'dist';

const CODEBLOCK_LANGUAGE_ALIASES = {
  sh: 'bash',
  ts: 'typescript',
  js: 'javascript',
  md: 'markdown',
  yml: 'yaml',
  jsonc: 'json'
};

const SUPPORTED_CODEBLOCK_LANGUAGES = new Set([
  'bash',
  'css',
  'go',
  'html',
  'javascript',
  'json',
  'markdown',
  'python',
  'shell',
  'toml',
  'typescript',
  'xml',
  'yaml'
]);

function getCodeblockLanguage(fenceInfo) {
  const raw = fenceInfo.trim().split(/\s+/)[0] ?? '';
  const language = CODEBLOCK_LANGUAGE_ALIASES[raw] ?? raw;
  return SUPPORTED_CODEBLOCK_LANGUAGES.has(language) ? language : undefined;
}

/** One `nve-badge` per config that enables the rule by default; a plain badge when it ships off. */
function configBadges(configs) {
  if (configs.length === 0) {
    return '<nve-badge>off by default (opt-in)</nve-badge>';
  }
  return configs.map(configName => `<nve-badge status="accent">${configName}</nve-badge>`).join(' ');
}

/**
 * Inserts a base-relative breadcrumb + config badges immediately after the
 * `# tools/<id>` heading every rule doc starts with, as a raw HTML block -
 * markdown-it has `html: true`, so it passes through untouched and the
 * layout's `<base>` tag resolves `eslint/` correctly under any `PAGES_BASE_URL`.
 */
function withRuleBadges(rule) {
  const [heading, ...rest] = rule.markdown.split('\n');
  const badges = `<div nve-layout="row gap:sm align:vertical-center"><a href="eslint/" nve-text="link">&larr; All rules</a> ${configBadges(rule.configs)}</div>`;
  return [heading, badges, ...rest].join('\n');
}

const RULES_CATALOG_MARKER = '<!-- agents-rules-catalog -->';

function renderRulesSectionMarkdown(rules) {
  const rows = rules
    .map(
      rule => `| [\`tools/${rule.id}\`](eslint/rules/${rule.id}/) | ${rule.summary} | ${configBadges(rule.configs)} |`
    )
    .join('\n');

  return `## Rules

Every rule \`@coryrylan/tools\` ships, generated at build time from [\`src/eslint/docs/rules/*.md\`](https://github.com/coryrylan/tools/tree/main/projects/lib/src/eslint/docs/rules) in the package itself - see each rule's page for the full rationale, examples, options, and "when not to use it" guidance.

| Rule | What it catches | Enabled by |
| --- | --- | --- |
${rows}`;
}

/**
 * Splices the generated rules catalog into the eslint surface page at its
 * marker comment - and fails the build the moment the marker disappears from
 * the surface doc, so the catalog can never silently drop off the page.
 */
function withRulesCatalog(markdown, rules) {
  if (!markdown.includes(RULES_CATALOG_MARKER)) {
    throw new Error(
      `eslint surface doc is missing the "${RULES_CATALOG_MARKER}" marker the rules catalog is generated into.`
    );
  }
  return markdown.replace(RULES_CATALOG_MARKER, renderRulesSectionMarkdown(rules));
}

/** Plain-text tool + rule catalog so agents (and anyone else scripting against the site) can discover what the package ships without parsing HTML. */
function renderLlmsTxt(rules, surfaces) {
  const lines = [
    '# @coryrylan/tools - shared tooling configs and lint rules for agent-maintained codebases',
    `# ${SITE_URL}`,
    '#',
    '# Surfaces - Format: <surface> - <one-line description> - <doc URL>',
    '',
    ...surfaces.map(surface => `${surface.id} - ${surface.summary} - ${SITE_URL}${surface.id}/`),
    '',
    '# ESLint rules - Format: <rule id> - <one-line description> - <doc URL>',
    '',
    ...rules.map(rule => `tools/${rule.id} - ${rule.summary} - ${SITE_URL}eslint/rules/${rule.id}/`)
  ];
  return `${lines.join('\n')}\n`;
}

export default function (eleventyConfig) {
  eleventyConfig.addPlugin(EleventyRenderPlugin);
  eleventyConfig.setFrontMatterParsingOptions({ language: 'js' });
  eleventyConfig.addPassthroughCopy('src/**/*.ts');
  eleventyConfig.addPassthroughCopy('src/**/*.css');
  eleventyConfig.addPassthroughCopy('src/favicon.svg');
  eleventyConfig.addPlugin(EleventyPluginVite, {
    viteOptions: {
      base: BASE_URL,
      build: {
        target: 'esnext',
        sourcemap: false,
        reportCompressedSize: false
      }
    }
  });

  if (BASE_URL !== '/') {
    eleventyConfig.setServerOptions({
      onRequest: {
        '/': () => ({
          status: 307,
          headers: {
            Location: BASE_URL
          }
        })
      }
    });
  }

  const markdown = markdownIt({
    html: true,
    breaks: true,
    linkify: true
  });

  const formats = {
    h1: 'display lg',
    h2: 'heading xl',
    h3: 'heading lg',
    h4: 'heading sm',
    h5: 'heading',
    h6: 'heading',
    p: 'body',
    a: 'link'
  };

  function renderer(tokens, idx, options, env, slf) {
    if (
      tokens[idx].type === 'heading_open' ||
      tokens[idx].type === 'link_open' ||
      tokens[idx].type === 'paragraph_open'
    ) {
      tokens[idx].attrSet('nve-text', formats[tokens[idx].tag]);
    }

    if (tokens[idx].type === 'bullet_list_open' || tokens[idx].type === 'ordered_list_open') {
      tokens[idx].attrSet('nve-text', 'list');
      tokens[idx].attrSet('nve-layout', 'column gap:xs');
    }

    return slf.renderToken(tokens, idx, options, env, slf);
  }

  markdown.renderer.rules.heading_open = renderer;
  markdown.renderer.rules.link_open = renderer;
  markdown.renderer.rules.paragraph_open = renderer;
  markdown.renderer.rules.bullet_list_open = renderer;
  markdown.renderer.rules.ordered_list_open = renderer;

  markdown.renderer.rules.code_inline = function codeInline(tokens, idx, options, env, slf) {
    tokens[idx].attrSet('nve-text', 'code');
    return `<code${slf.renderAttrs(tokens[idx])}>${markdown.utils.escapeHtml(tokens[idx].content)}</code>`;
  };

  markdown.renderer.rules.fence = function fence(tokens, idx) {
    const token = tokens[idx];
    const language = getCodeblockLanguage(token.info || '');
    const languageAttr = language ? ` language="${language}"` : '';
    const code = markdown.utils.escapeHtml(token.content.replace(/\n$/, ''));
    return `<nve-codeblock${languageAttr}>${code}</nve-codeblock>\n`;
  };

  markdown.renderer.rules.table_open = () => '<nve-grid container="flat">\n';
  markdown.renderer.rules.table_close = () => '</nve-grid>\n';
  markdown.renderer.rules.thead_open = (tokens, idx, options, env) => {
    env.insideThead = true;
    return '<nve-grid-header>\n';
  };
  markdown.renderer.rules.thead_close = (tokens, idx, options, env) => {
    env.insideThead = false;
    return '</nve-grid-header>\n';
  };
  markdown.renderer.rules.tbody_open = () => '';
  markdown.renderer.rules.tbody_close = () => '';
  markdown.renderer.rules.tr_open = (tokens, idx, options, env) => (env.insideThead ? '' : '<nve-grid-row>\n');
  markdown.renderer.rules.tr_close = (tokens, idx, options, env) => (env.insideThead ? '' : '</nve-grid-row>\n');
  markdown.renderer.rules.th_open = () => '<nve-grid-column><span>';
  markdown.renderer.rules.th_close = () => '</span></nve-grid-column>\n';
  markdown.renderer.rules.td_open = () => '<nve-grid-cell><span>';
  markdown.renderer.rules.td_close = () => '</span></nve-grid-cell>\n';

  eleventyConfig.setLibrary('md', markdown);

  // Rule pages, surface pages, and llms.txt are virtual
  // templates built from ../lib/src/**/docs markdown rather than files on
  // disk - loadRules() fails the build the moment the rule docs drift from
  // the plugin's own rule registry (see rule-docs.js), and loadSurfaces()
  // fails it when the surface docs drift from the package exports map
  // (see surface-docs.js).
  const rules = loadRules();
  const surfaces = loadSurfaces();

  // The layout builds its nav from this list, so the menu is derived from the
  // same validated surface set as the pages instead of a hand-kept mirror.
  eleventyConfig.addGlobalData(
    'surfaces',
    surfaces.map(surface => surface.id)
  );

  for (const surface of surfaces) {
    const markdown = surface.id === 'eslint' ? withRulesCatalog(surface.markdown, rules) : surface.markdown;
    eleventyConfig.addTemplate(`${surface.id}.md`, markdown, {
      title: `${surface.id} · @coryrylan/tools`,
      description: surface.summary,
      layout: 'index.11ty.js',
      // Markdown only, no Liquid preprocessing - the vale page's ini examples
      // contain literal `{%`/`{{` sequences Liquid would choke on.
      templateEngineOverride: 'md'
    });
  }

  for (const rule of rules) {
    eleventyConfig.addTemplate(`eslint/rules/${rule.id}.md`, withRuleBadges(rule), {
      title: `eslint/rules/${rule.id} · @coryrylan/tools`,
      description: rule.summary,
      layout: 'index.11ty.js'
    });
  }

  // Routed through Vite's `publicDir` convention (default `public/`), not
  // written as a plain `llms.txt` virtual template: the Vite build step
  // renames the whole 11ty output directory aside, rebuilds it from only the
  // HTML/CSS/JS asset graph, and discards everything else that was in it -
  // including a plain-text file with no assets of its own, even one written
  // from an `eleventy.after` hook registered after addPlugin(EleventyPluginVite),
  // since 11ty runs `eleventy.after` listeners in parallel and the directory
  // rename can win the race against a later write. `publicDir` is the one
  // thing Vite copies into the rebuilt output verbatim, so a virtual
  // template permalinked under `public/` survives the rebuild.
  eleventyConfig.addTemplate('llms.html', renderLlmsTxt(rules, surfaces), {
    permalink: 'public/llms.txt',
    layout: false,
    templateEngineOverride: false
  });

  return {
    dir: {
      input: 'src',
      output: OUTPUT_DIR,
      layouts: '_layouts'
    }
  };
}

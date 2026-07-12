# @coryrylan/tools

Home of `@coryrylan/tools`: an opinionated collection of tooling configs and
presets for agent-driven codebases - where coding agents write most of the
code and quality has to be enforced by the toolchain rather than requested in
prose. It covers the whole chain: linting (ESLint flat configs plus custom
`tools/*` rules), formatting (Prettier), CSS conventions (Stylelint), prose
style (Vale), library builds (Vite), and testing with coverage gates
(Vitest). The opinions are my own personal preferences, tuned for strictness:
every preset ships at its tightest setting, encoding what would otherwise be
an `AGENTS.md` paragraph - which an agent can skim past or forget - as a
deterministic gate that fails the build. Relax specific rules per project
rather than expecting softer defaults upstream.

- Package README (install, surfaces, full rule reference): [projects/lib/README.md](./projects/lib/README.md)
- Docs site: https://coryrylan.github.io/tools/

## Layout

This is a pnpm workspace with two packages:

- `projects/lib` - the `@coryrylan/tools` npm package: the ESLint plugin, its flat configs and custom `tools/*` rules, plus the Prettier, Stylelint, Vale, Vite, and Vitest surfaces.
- `projects/docs` - the static documentation site (Eleventy + NVIDIA Elements, deployed to GitHub Pages via `.github/workflows/pages.yml`).

The repository consumes every surface it ships: the root `eslint.config.js`,
`prettier.config.js`, `stylelint.config.js`, and `.vale.ini` all resolve to
`@coryrylan/tools`, and `projects/lib` builds and tests itself with its own
Vite and Vitest presets.

## Development

### Setup

Install [mise](https://mise.jdx.dev/) then run setup at the root of the repository:

```sh
curl https://mise.run | sh
~/.local/bin/mise run setup
```

This installs Node.js, pnpm, and Vale from `mise.toml`, installs dependencies, syncs Vale style packages, and runs the full CI suite.

If you're coming from another repository, refresh the toolchain with `mise run install`.

### Building

```sh
mise exec -- pnpm run ci   # full gate: typecheck, build, test, eslint, prettier, stylelint, vale, docs build
mise exec -- pnpm lint     # repo-wide eslint
pnpm run format:fix        # prettier write
```

## License

MIT - see [LICENSE](./LICENSE).

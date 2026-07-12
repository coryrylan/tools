# vale

A prose-lint starter kit for the Vale linter: an ini template plus a shared accept/reject vocabulary.

## Usage

Vale is a Go binary, not an npm package - install it with [mise](https://mise.jdx.dev/) or Homebrew:

```sh
mise use vale@latest
# or
brew install vale
```

Point a `.vale.ini` at the project root, at this package's dist output:

```ini
StylesPath = node_modules/@coryrylan/tools/dist/vale/styles
MinAlertLevel = warning
Vocab = Tools
Packages = Google, write-good
```

`vale sync` downloads the `Google` and `write-good` style packages into `StylesPath` on first run - run it once after install, then lint:

```sh
vale sync
vale README.md src/
```

## What it provides

- `vale.ini` - a template that enables the `Google` and `write-good` style packages for `*.md` files, and a `*.ts` section that runs `write-good.TooWordy` and `write-good.Passive` as errors against JSDoc comments. Spelling and terminology checks are off in the `*.ts` section - identifiers aren't prose. The `*.md` section also carries a `TokenIgnores` pattern for template-syntax delimiters (`{% ... %}`, `{{ ... }}`) so templating-engine markup doesn't get flagged as prose.
- `styles/config/vocabularies/Tools/accept.txt` - web-platform and tooling terms (`ESLint`, `TypeScript`, `pnpm`, `monorepo(s)`, `SSR`, and similar) added to the spell-check dictionary so they don't get flagged as typos.
- `styles/config/vocabularies/Tools/reject.txt` - terms this vocabulary bans in favor of a preferred alternative: `blacklist`/`whitelist` (prefer `blocklist`/`allowlist`), `e-mail`, `web site`, and vague `repo`/`repository admin` references.

## Extending

Add project-specific terms to your own vocabulary and list it in `Vocab`. Vale's `Vocab` key documentation shows a single vocabulary name - don't assume comma-separated multi-vocabulary support without checking your installed Vale version's own docs. If it isn't supported, copy the `Tools` accept/reject terms into your own vocabulary directory alongside your project's terms, and point `Vocab` at that combined directory instead.

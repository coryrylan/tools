# docs

The documentation site for [`@coryrylan/tools`](../lib/). Not published or released - it's built and deployed as a static site to GitHub Pages.

## Getting started

Install dependencies at the repo root, then run the dev server from this package:

```sh
pnpm install
cd projects/docs
pnpm run dev
```

Open http://localhost:8083/ to view the site.

## Tasks

| Command          | Description                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm run dev`   | Start the local development server                                                                                                   |
| `pnpm run build` | Generate the production site into `dist/`, including the rule pages, rules index, and `llms.txt` generated from `../lib`'s rule docs |
| `pnpm run lint`  | Lint the JavaScript and TypeScript source with ESLint                                                                                |
| `pnpm run ci`    | Run `lint` + `build` (used in CI)                                                                                                    |

See the [Eleventy documentation](https://www.11ty.dev/docs/) for template, data, and configuration details, and `AGENTS.md` for how the rule pages are generated from the `lib` package's docs.

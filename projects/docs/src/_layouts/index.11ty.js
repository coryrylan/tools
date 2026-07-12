const BASE_URL = process.env.PAGES_BASE_URL ?? '/';

/** Display-name overrides for surface ids whose casing isn't a simple capitalize-first. */
const SURFACE_LABELS = { eslint: 'ESLint' };

function surfaceNavItem(surfaceId) {
  const label = SURFACE_LABELS[surfaceId] ?? surfaceId.charAt(0).toUpperCase() + surfaceId.slice(1);
  return { label, href: `${surfaceId}/`, url: `/${surfaceId}/` };
}

function isSelected(item, currentUrl) {
  return item.url === '/' ? currentUrl === '/' : currentUrl.startsWith(item.url);
}

export function render(data) {
  const title = data.title ?? '@coryrylan/tools';
  const description =
    data.description ??
    'Opinionated, strictness-first tooling configs for codebases where coding agents are the primary contributors.';
  const currentUrl = data.page?.url ?? '/';

  const navItems = [{ label: 'Introduction', href: './', url: '/' }, ...data.surfaces.map(surfaceNavItem)];

  const menuItems = navItems
    .map(item => {
      const openTag = isSelected(item, currentUrl) ? '<nve-menu-item selected>' : '<nve-menu-item>';
      return `${openTag}<a href="${item.href}">${item.label}</a></nve-menu-item>`;
    })
    .join('\n                  ');

  return /* html */ `
    <!DOCTYPE html>
      <html lang="en" nve-theme="dark" nve-transition="auto">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta name="description" content="${description}">
          <meta http-equiv="X-UA-Compatible" content="ie=edge">
          <base href="${BASE_URL}" />
          <title>${title}</title>
          <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
          <link rel="stylesheet" href="/_layouts/index.css" />
          <script type="module" src="/_layouts/index.ts"></script>
        </head>
        <body>
          <nve-page>
            <!-- UI built with https://nvidia.github.io/elements/ -->
            <nve-page-header slot="header">
              <a slot="prefix" href="./" nve-text="heading sm">@coryrylan/tools</a>
              <nve-button slot="suffix" container="flat"><a href="https://github.com/coryrylan/tools" target="_blank">GitHub</a></nve-button>
              <nve-icon-button
                slot="suffix"
                container="flat"
                icon-name="menu"
                popovertarget="nav-drawer"
                aria-label="menu"
                class="nav-drawer-toggle"
              ></nve-icon-button>
            </nve-page-header>
            <nve-page-panel slot="left" size="sm" class="nav-page-panel">
              <nve-page-panel-content>
                <nve-menu>
                  ${menuItems}
                </nve-menu>
              </nve-page-panel-content>
            </nve-page-panel>
            <main nve-layout="column gap:lg pad:lg align:horizontal-stretch">
              ${data.content}
            </main>
          </nve-page>
          <nve-drawer id="nav-drawer" position="left" size="sm" closable modal>
            <nve-drawer-header>
              <h3 nve-text="heading sm">Navigation</h3>
            </nve-drawer-header>
            <nve-drawer-content>
              <nve-menu>
                ${menuItems}
              </nve-menu>
            </nve-drawer-content>
          </nve-drawer>
        </body>
      </html>
  `;
}

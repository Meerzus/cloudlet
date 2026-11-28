# Contributing

Thanks for taking the time. Cloudlet is maintained by one person, so a short issue first saves us
both time: for anything larger than a typo, open an issue and agree on the change before writing it.

- **Bugs:** use the bug report template, with the version, the browser and a reproduction.
- **Ideas:** use the feature request template and describe the problem before the solution.
- **Security problems:** never in a public issue; see [SECURITY](SECURITY.md).

## Workspace

This repository holds the kit's components, their website and their tests.

| Path | Contents |
|---|---|
| `packages/toast` | `@cloudlet/toast`, the Toaster: notification and operation controller, React adapter, the stack/Island shell, public types, CSS and its own build ([README](packages/toast/README.md)) |
| `apps/site` | The website at cloudlet.dev: landing pages and the documentation at `/docs`. The Color picker and the Color palette live here, in `apps/site/src/components/ui/color-picker` and `apps/site/src/components/ui/color-palette` |
| `apps/lab` | The interactive laboratory and the isolated fixtures the browser tests run on ([README](apps/lab/README.md)) |
| `registry` | The shadcn registry: `registry.json` lists the Toaster (a thin client wrapper and a CSS theme bridge in `registry/cloudlet`), the Color picker and the Color palette (their source files in `apps/site`) ([README](registry/README.md)) |
| `fixtures` | Installed-archive consumers: Vite/React 18.2 and 19, Next App/Pages, and the strict type contracts `check:package` compiles against the packed archives |
| `tests` | Unit, React, contract, tooling and Playwright browser suites ([README](tests/README.md)) |
| `scripts` | Packing, documentation checks, notices and release verification |

## Setup

Node **24.17.0** and npm **11.12.1** are pinned (`.nvmrc`, `packageManager`, Volta). The workspace
has one `package-lock.json`; isolated consumers and registry tooling keep their own lockfiles.
Please do not add another lockfile or switch package managers.

```sh
npm ci
npm run dev        # the laboratory
npm run dev:site   # the website and documentation
```

## Commands

```sh
npm run check       # strict typecheck, unit tests, library build, tarball checks
npm run check:docs  # every documentation example typechecks; every public export is documented
```

Other commands:

- `npm run build:site` builds the website's static export;
- `npm run test:tooling`, `npm run test:consumers`, `npm run test:managers` and
  `npm run test:registry` run the tooling, installed-consumer, package-manager and registry suites.
  The last three install the packed archive, so run `npm run pack:local` first, and again after
  every change to the package. `test:consumers` and `test:registry` open Chromium, Firefox and WebKit:
  install them once with `npx playwright install chromium firefox webkit`. `test:managers` needs
  `corepack` (it brings pnpm and yarn) and [Bun](https://bun.sh) on your `PATH`; without Bun, limit
  the run to the managers you have: `node scripts/package-managers.mjs --only npm,pnpm,yarn`.
  `test:registry` needs the shadcn CLI of the registry tooling:
  `npm ci --prefix registry/tooling --ignore-scripts --no-audit --no-fund`;
- `npm run release:verify` runs the whole chain from a clean install to the packed archive.

Browser end-to-end tests build the production package and run Chromium, Firefox and WebKit under a
strict CSP:

```sh
npx playwright install chromium firefox webkit
npm run test:e2e
```

## Before a pull request

Run `npm run check` and `npm run check:docs`. Changes to rendering or motion should also pass the
browser suite (`npm run test:e2e`).

- Keep a pull request to one change, and describe what it changes and why.
- A change to the public API or to behaviour gets an entry under `## Unreleased` in the changelog of
  the package it changes ([`@cloudlet/toast`](packages/toast/CHANGELOG.md),
  [`@cloudlet/agent`](packages/agent/CHANGELOG.md); the website and registry items:
  [apps/site](apps/site/CHANGELOG.md)) and an update of the documentation in `apps/site/content/docs`.
- Open the pull request against `main`; CI runs there.

By contributing you agree that your work is licensed under the [MIT License](LICENSE) and that you
follow the [Code of Conduct](CODE_OF_CONDUCT.md).

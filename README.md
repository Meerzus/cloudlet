# Cloudlet

Cloudlet is a family of React components; this repository holds them, their website and their
tests. The first one is the **Toaster**, `@cloudlet/toast`: one stack of notifications that collapses
to a single pill and opens into the Island, a surface with a slider over every notification. Its
[README](packages/toast/README.md) has the quickstart.

**Documentation: https://cloudlet.dev/toaster/docs**

```sh
npm install @cloudlet/toast
```

## Workspace

| Path | Contents |
|---|---|
| `packages/toast` | `@cloudlet/toast`: notification and operation controller, React adapter, the stack/Island shell, public types, CSS and its own build |
| `apps/site` | The website at cloudlet.dev: landing page, Playground and the documentation at `/toaster/docs` |
| `apps/lab` | The interactive laboratory and the isolated fixtures the browser tests run on ([README](apps/lab/README.md)) |
| `registry` | The shadcn registry item: a thin client wrapper and a CSS theme bridge ([README](registry/README.md)) |
| `fixtures` | Installed-archive consumers: Vite/React 18.2 and 19, Next App/Pages, size measurement |
| `tests` | Unit, React, contract, tooling and Playwright browser suites ([README](tests/README.md)) |
| `scripts` | Packing, documentation checks, size reports, notices and release verification |

## Development

Node **24.17.0** and npm **11.12.1** are pinned (`.nvmrc`, `packageManager`, Volta). The workspace
has one `package-lock.json`; isolated consumers and registry tooling keep their own lockfiles.

```sh
npm ci
npm run check
npm run dev
```

`check` runs the strict typecheck, unit tests, the library build, the tarball checks and the size
report. `dev` starts the laboratory; `npm run dev:site` starts the website. Other commands:
`npm run build:site`, `npm run check:docs` (typechecks every documentation example and requires every
public export to be documented), `npm run test:tooling`, `npm run test:consumers`,
`npm run test:registry`, `npm run release:verify` (the whole chain from a clean install to the packed
archive).

Browser end-to-end tests build the production package and run Chromium, Firefox and WebKit under a
strict CSP:

```sh
npx playwright install chromium firefox webkit
npm run test:e2e
```

## License

[MIT](LICENSE). Third-party notices: [packages/toast](packages/toast/THIRD_PARTY_NOTICES.md),
[apps/site](apps/site/THIRD_PARTY_NOTICES.md). The [changelog](CHANGELOG.md) lists every release.

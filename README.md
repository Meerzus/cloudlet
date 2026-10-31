<a href="https://cloudlet.dev/toaster">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/wordmark-night.webp">
    <img src=".github/readme/wordmark-day.webp" alt="Cloudlet, written in clouds across the sky" width="100%">
  </picture>
</a>

# Cloudlet

[![npm](https://img.shields.io/npm/v/@cloudlet/toast?color=245cdb)](https://www.npmjs.com/package/@cloudlet/toast)
[![min+gzip](https://img.shields.io/badge/min%2Bgzip-9.3%20KB%20first%20load-245cdb)](https://cloudlet.dev/toaster#faq)
[![CI](https://github.com/Meerzus/cloudlet/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Meerzus/cloudlet/actions/workflows/ci.yml)
[![types](https://img.shields.io/npm/types/@cloudlet/toast)](https://www.npmjs.com/package/@cloudlet/toast)
[![license](https://img.shields.io/npm/l/@cloudlet/toast)](https://github.com/Meerzus/cloudlet/blob/main/LICENSE)

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
`npm run test:managers`, `npm run test:registry`, `npm run release:verify` (the whole chain from a clean install to the packed
archive).

Browser end-to-end tests build the production package and run Chromium, Firefox and WebKit under a
strict CSP:

```sh
npx playwright install chromium firefox webkit
npm run test:e2e
```

## Contributing

Bug reports and ideas are welcome in [issues](https://github.com/Meerzus/cloudlet/issues); read
[CONTRIBUTING](CONTRIBUTING.md) before a pull request. Security problems go through
[SECURITY](SECURITY.md), not public issues. Everyone taking part follows the
[Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE). Third-party notices: [packages/toast](packages/toast/THIRD_PARTY_NOTICES.md),
[apps/site](apps/site/THIRD_PARTY_NOTICES.md). The [changelog](CHANGELOG.md) lists every release.

# Contributing

Thanks for taking the time. Cloudlet is maintained by one person, so a short issue first saves us
both time: for anything larger than a typo, open an issue and agree on the change before writing it.

- **Bugs:** use the bug report template, with the version, the browser and a reproduction.
- **Ideas:** use the feature request template and describe the problem before the solution.
- **Security problems:** never in a public issue; see [SECURITY](SECURITY.md).

## Setup

Node **24.17.0** and npm **11.12.1** are pinned (`.nvmrc`, `packageManager`, Volta). The workspace
has one `package-lock.json`; please do not add another lockfile or switch package managers.

```sh
npm ci
npm run dev        # the laboratory
npm run dev:site   # the website and documentation
```

## Before a pull request

```sh
npm run check       # typecheck, unit tests, library build, tarball checks, size report
npm run check:docs  # every documentation example typechecks; every public export is documented
```

Changes to rendering or motion should also pass the browser suite:

```sh
npx playwright install chromium firefox webkit
npm run test:e2e
```

- Keep a pull request to one change, and describe what it changes and why.
- A change to the public API or to behaviour gets an entry in [CHANGELOG](CHANGELOG.md) and an update
  of the documentation in `apps/site/content/docs`.
- Open the pull request against `main`; CI runs there.

By contributing you agree that your work is licensed under the [MIT License](LICENSE) and that you
follow the [Code of Conduct](CODE_OF_CONDUCT.md).

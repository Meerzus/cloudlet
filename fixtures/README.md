# Consumer fixtures

`size/` builds production consumers from the installed npm archive.
[`integration/`](integration/README.md) verifies isolated Vite/React 18.2 and 19, and Next App/Pages consumers from the same archive, including types, SSR/hydration, CSS and strict CSP. Each isolated consumer has its own committed lockfile; workspace packages use the root lockfile.

Current Playwright engines are automated runtime checks. Minimum browser versions, real Safari/PWA, AT and physical device performance remain open release gates in [release readiness](../docs/RELEASE_READINESS.md).

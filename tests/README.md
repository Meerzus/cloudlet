# Tests

## Unit and React (Vitest)

- `tests/contracts/` — compile-only positive and negative examples of the public and the closed
  contract; part of `npm run typecheck`.
- `tests/unit/` — the DOM-free controller (identity, admission, dedupe, the cap, the stack and
  `current`, `attention` on injected time, timers, snapshots, events, cleanup, seeded generated
  sequences), operations and actions with their races, the shell sampler and transition plan, swipe
  physics, SSR, and the website's data (Get started, FAQ, sizes, indexing, READMEs).
- `tests/react/` — jsdom and Testing Library on the public API: Provider and leases, Strict Mode, the
  queue before mount, the stack and the Island, focus, gestures, `classNames`, progress,
  announcements, the lazy renderer. jsdom proves state, focus and leases, not physics or speech.
- `tests/support/` — manual clock, deferred promises, the controller harness and the motion mock.

```sh
npm test
npm test -- --project unit
npm test -- --project react
```

## Browser (Playwright: Chromium, Firefox, WebKit)

`npm run test:e2e` builds the library and the production laboratory and serves them with
`scripts/serve-csp.mjs` on `127.0.0.1:4173`: external CSS, a nonce, `style-src-attr 'none'`. Every
spec runs the shared audit in `tests/e2e/shell-audit.ts`: no CSP violations or page errors, no style
attributes in the host, at most one inert snapshot per layer, focus never left in a hidden branch.

| Spec | Route | What it checks |
|---|---|---|
| `harness.spec.ts` | `/` | Production entry, auto-open, clear, axe |
| `island.spec.ts` | `/` | The shell: open, slide, close, a still shell while sliding, slow motion, reduced motion |
| `stack.spec.ts` | `?fixture=mobile` | Arrival, tails and badge, hover, swipe to dismiss, timers, overflow |
| `slider.spec.ts` | `?fixture=slider`, `?fixture=attention` | Roles and names, keys, dots, swipes, trackpad, RTL, `attention` on `page.clock` |
| `accessibility.spec.ts` | `?fixture=accessibility` | Focus order, live regions, 320 px with 200 % text, forced colours, reduced motion, axe |
| `mobile.spec.ts` | `?fixture=mobile` | Positions, safe areas, VisualViewport, the bottom edge, touch, cancellations, portals, emulated devices |
| `surface.spec.ts` | `?surface` | Width and font changes, loading → success/error in place, dark theme, resource release |
| `lab.spec.ts` | `/`, fixtures | The laboratory: scenario, motion panel, generators, two controllers, stress and cleanup |

```sh
npm run test:e2e -- tests/e2e/slider.spec.ts --project=chromium
```

Reports go to `playwright-report/`, failure traces to `test-results/`. Device presets, the mocked
VisualViewport, CDP touch and `emulateMedia` are emulation: screen readers, physical phones, real
high contrast and the minimum browser versions are checked by hand.

## Package, consumers, registry, size

- `npm run check` — typecheck, unit and React tests, build, the tarball guards (`check:package`) and the
  size report.
- `npm run test:consumers` — the packed archive installed into Vite React 18.2/19 and Next App/Pages
  under a strict CSP (`fixtures/integration`).
- `npm run test:registry` — `shadcn add` from a loopback registry into a Next consumer, in three engines.
- `npm run check:docs` — every TS/TSX example of the READMEs and the documentation compiles.
- `npm run release:verify` — the whole chain from a clean install, with input fingerprints, into
  `artifacts/release/<version>/<timestamp>/`.

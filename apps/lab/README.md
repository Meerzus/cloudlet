# Cloudlet laboratory

A local consumer of `@cloudlet/toast` that uses only its public API: the stand where the motion was
tuned and the isolated fixtures the browser tests run on. Its interface is in Russian.

## Running

From the workspace root, Node 24.17.0 / npm 11.12.1:

```sh
npm run build
npm run dev
```

Open the Vite address from the terminal (usually `http://127.0.0.1:5173`). The laboratory takes the
package from `packages/toast/dist`: rebuild it after changing the package.

```sh
npm run build:lab   # a separate production consumer, after the library build
npx playwright test tests/e2e/lab.spec.ts tests/e2e/island.spec.ts --project=chromium
```

## The main page `/`

- **Header:** `timeScale` 1 / 0.5 / 0.25 / 0.1 for both Toasters.
- **Scenario:** three notifications → open the Island → close the current one → collapse, with a log
  of transitions (`data-state`, reason, current).
- **Generators:** `attention` auto / open / stack with a description, an action, a retry, progress or
  nothing; loading → success/error through `track`; overflow to 101 and acknowledge.
- **Motion panel:** every motion constant as `motion.overrides`, live; reset, copy and paste JSON
  (`{ timeScale, motion, changed }`, the shape of `CloudletMotionConstants`), kept in the browser.
- **Environment, identity and time, operations, capacity and stress, observation, a second
  controller, full reset:** the rest of the public API, each with its expected result on screen.

The laboratory's own controls never collapse the Island: they sit outside the host's outside-press
rule on purpose.

## Fixtures

Query routes work on Vite and on the production CSP server without an SPA fallback.

| Route | Checks |
|---|---|
| `?fixture=attention` | Deterministic auto-open (`delay`, `theme`, `dir`, `position`, `timeScale`) |
| `?fixture=slider` | `count` notifications (1–12) with the Island open |
| `?fixture=no-reset` | Native UA defaults, no global reset |
| `?fixture=hostile` | Global element selectors the shell must not inherit |
| `?fixture=long-text` | Russian, Arabic and a long URL in one stack; RTL |
| `?fixture=zoom` | Root text at 200 % for rem and reflow |
| `?fixture=portal` | A same-document HTML portal |
| `?fixture=inset` | A bottom navigation bar, an obstruction and a native input |
| `?fixture=visual` | The look: `theme`, `page`, `dir`, `position`, `scenario=mix\|progress\|kinds\|overflow` |
| `?surface` | The shell under container width, font and theme changes; `window.surfaceFixture` |
| `?fixture=accessibility` | Keyboard, roles and names, localization, announcements; `window.accessibilityFixture` |
| `?fixture=mobile` | Viewport, safe area, portals, swipes; `window.mobileFixture` |

This is browser UI in an app window: hardware Dynamic Island, Web Push, real keyboards and safe
areas, physical phones, screen readers and the minimum browser versions are outside what it proves.

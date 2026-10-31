# Changelog

## 1.1.1 — 2026-10-31

The package's code, CSS and types are the same as in 1.1.0. This is the first release published from
GitHub Actions through npm Trusted Publishing, with a provenance attestation that links the archive
to its commit and workflow run.

### Documentation

- The README on npm shows the version, first-load size, CI, types and license badges, lists the
  Forms and Content Security Policy guides, and says how to contribute and how to report a
  vulnerability privately.

## 1.1.0 — 2026-10-30

Forms in the Island and a badge that passes text contrast. Nothing is removed or changed in
behaviour; the new texts and type parameters are additive (see API).

### Features

- Forms in the Island. A third primary action, `{ kind: 'form', label, fields, run, validate?, errorMessage? }`,
  puts one to three text fields (`'text'` or `'textarea'`) in the open Island beside a round send button.
  On send Cloudlet checks `required`, then `maxLength`, then your `validate`, shows messages under the
  fields, and runs `run({ values })` with command semantics: pending, close on success, a message and
  another try on failure. TypeScript takes `values`' keys from the field names. Guide:
  [Forms](https://cloudlet.dev/toaster/docs/forms).
- Drafts. Typed text stays with its notification across collapsing, swiping and remounting. While a form
  holds unsent text its time stands still (pause reason `'draft'`), a press outside does not collapse
  the Island, an auto-opening notification waits in the stack, and the pill's name adds `labels.draft`.
  `NotificationSnapshot.draft` reports it.

### API

- New types `FormAction`, `FormField`, `FormFieldKind`, `FormInputMode`, `FormValues`, `FormContext` and
  `FormValidation`; `PrimaryAction` includes `FormAction`. `show` and `update` take the field names as a
  type parameter, inferred from the call.
- New texts: `labels.draft`, `messages.fieldRequired` and `messages.fieldTooLong`. An object typed as the
  full `CloudletLabels` or `FallbackMessages` now needs them; TypeScript points them out.
- New CSS tokens `--cloudlet-field-background`, `--cloudlet-field-border`, `--cloudlet-placeholder` and
  `classNames` parts `form`, `field`, `field-error`.

### Fixes

- The badge's disc is a deeper red (`--cloudlet-badge` `#ff3b30` → `#d70015`): its white number now
  measures 5.38:1 instead of 3.55:1 and passes the 4.5:1 text contrast.

## 1.0.0 — 2026-10-29

The first stable release, published to npm as `latest` (`npm install @cloudlet/toast`). The API is the
one of 1.0.0-rc.3 plus one diagnostic code; it follows semantic versioning from here. After the release the
remaining manual checks passed on this version: VoiceOver on iOS, NVDA, TalkBack, physical phones,
Windows High Contrast and the minimum browser versions (the documentation's Accessibility page).

### Performance

- `Toaster` loads its renderer (host, motion, cards, gestures, announcer) as a separate chunk through
  `import()`, once per page, on the client after mount. The JavaScript an app pays for at start drops
  from 27953 to 8602 B min+gzip; the renderer chunk follows right after. Notifications shown meanwhile
  wait in the controller. No `React.lazy` or `Suspense` is needed in the app, and server rendering is
  unchanged: Toaster renders nothing on the server.

### API

- New diagnostic `renderer-load-error`: the renderer chunk failed to load (offline, for example). The
  notifications wait in the controller, and the next Toaster mount loads the chunk again.

### Fixes

- The Island's background no longer counts as layout shift while it morphs at the bottom edge: it is
  placed with a transform instead of `bottom: 0`. Pixels are unchanged.
- On a slow first frame, the queue aggregate ("2 notifications queued") was spoken alone before the
  newest record's title. The announcer now waits until the pill is readable and speaks the title first
  and the queue after it, as on fast devices.

### shadcn item

- The wrapper takes a controller that may still be `null` (`ReactCloudletController | null`), so an app
  can render it before its client owner has created the controller.

## 1.0.0-rc.3 — 2026-10-25

Release candidate, published to npm on 2026-10-27 under the `next` dist-tag
(`npm install @cloudlet/toast@next`; integrity
`sha512-iYdZ7n/eH5gtLD4+QQTwQp/mtKCMNoCi89BWwTJw2G+qT86V9OwrK1pE3kwaxModaFO7t4EHvS8wQoS1iOIbFA==`).
It carries the fixes from the VoiceOver + Safari gate on 1.0.0-rc.2 (slide revisits, assertive text in
the open Island, repeated messages) and localizable role words, so that gate can be closed on an
archive.

### Migrating from 1.0.0-rc.2

- A full `CloudletLabels` object (not a `Partial`) needs the new `carousel` and `slide` strings.
- The live regions are `div.cloudlet-announcer` elements beside `.cloudlet-host`, created by the
  announcer, instead of children of the host. Code that queried `.cloudlet-host [aria-live]` should use
  `[data-cloudlet-announcer]`.

### API

- `CloudletLabels` gains `carousel` and `slide`: the spoken roles (`aria-roledescription`) of the open
  Island and of each slide, `'carousel'` and `'slide'` by default. A localized Island no longer speaks
  English role words (found in the VoiceOver + Safari run on 1.0.0-rc.2).

### Fixes (VoiceOver + Safari gate on 1.0.0-rc.2)

- Moving back to a slide already shown in the open Island (arrow keys, Home/End, the dots, a swipe, or
  the next slide after Close) now announces it once, politely. The title is one element across slides,
  so focus never changed and VoiceOver said nothing.
- Assertive announcements (a failed operation, for example) are spoken while focus is inside the open
  Island. The announcer now creates its two live regions itself, next to the host, and re-inserts them
  once on the next frame: VoiceOver in Safari ignored assertive changes in regions inserted only once
  (0 of 6 runs) and spoke them after the re-insertion (6 of 6).
- The same announcement twice in a row (a second failed attempt) is spoken again: the region gets a
  trailing no-break space so it changes.
- The live regions are now `div.cloudlet-announcer` elements beside `.cloudlet-host` instead of inside it.

## 1.0.0-rc.2 — 2026-10-25

Local, private release candidate. It closes the library questions collected while building the landing
page and the documentation site (own motion generators, export map, provider/auto-dismiss/theme API and
interaction fixes) before the manual accessibility, device and Safari gates, which now run on this
candidate. Stable release readiness stays **not ready**; nothing has been
published.

### Migrating from 1.0.0-rc.1

- `requestFocus({ kind: 'notification', handle, control })` while the Island is collapsed returns
  `{ status: 'rejected', reason: 'not-visible' }` instead of `requested`. Open the Island first, or omit
  `control` to focus the pill.
- The `--cloudlet-stack-gap` token is gone; it never affected layout, so remove any override.
- A successful factory attempt shows no Retry button. Call `retry()` on the handle if you offer a
  "run again" elsewhere.
- `useCloudlet()` now also throws while the provider's controller is `null`; use `useOptionalCloudlet()`
  in components that render before the controller exists.

### API (review of open library questions)

- `CloudletProvider` accepts `controller={null}` while an effect-owned controller does not exist yet
  (server render, first client render). Under it `Toaster` renders nothing, so an owner can wrap the
  whole application without losing server HTML. `Toaster` outside any Provider still throws.
- New `useOptionalCloudlet()` (and type `UseOptionalCloudlet`): the controller, or `null` outside a
  Provider and while its controller is `null`. `useCloudlet()` throws in both cases.
- New `<Toaster autoDismiss>`: overrides `ControllerOptions.autoDismiss` while defined and applies
  without a remount. Off stops every timer; on starts each notification's timer from its full duration;
  removing the prop restores the controller's option. A non-boolean value reports `invalid-input`
  (source `Toaster.autoDismiss`).
- The host carries `data-resolved-theme="light|dark"`: the theme in effect, following
  `prefers-color-scheme` while `theme` is `system`. `data-theme` still carries the prop's value.
- `requestFocus({ kind: 'notification', control })` while the Island is collapsed now returns
  `rejected: 'not-visible'` at once. It used to return `requested`, then fail silently, because card
  controls exist only in the Island.
- Removed the `--cloudlet-stack-gap` token: the host has a single laid-out child, so it never applied.

### Fixes

- The `hover` pause no longer sticks after the hovered card disappears under a still pointer (Chromium
  and Firefox send no `mouseout`, so React never saw the leave and auto-open waited until the next
  hover). The next `pointerover` outside the host now releases it. Reported by the landing playground.
- A successful attempt of a factory no longer shows a Retry button. `retry()` and `canRetry` are
  unchanged; the button follows the core rule that only an unsuccessful attempt offers retry.
- A scrolling Island body is a tab stop (`tabindex=0`, `role=group`, named by the title): Safari never
  makes scrollers focusable, and a focused action below a long description could not scroll back up.
  `Home`/`End` on that body scroll it instead of switching slides.
- The JS fallbacks of `--cloudlet-tail-offset`/`--cloudlet-tail-scale` match the stylesheet (4 / 0.9).

### Size (experiment E1)

- `motion` is no longer a dependency of the package: the shell sampler runs on Cloudlet's own numeric
  generators (`src/react/generators.ts`), the spring and two-keyframe `easeOut` tween ported from
  Motion 14.3.0 (MIT, attributed in THIRD_PARTY_NOTICES). A reference test samples both
  implementations every millisecond for every `MOTION` configuration, boundary overrides and release
  velocities: values and velocities match bit for bit, `done` flips on the same frame, so the owner's
  motion is unchanged. Full consumer delta 34461 → 30690 B gzip; own JS 26089 → 27340 B (the
  generators now count as own code); a consumer that already ships Motion pays 29258 → 30514 B.
  `check-package` now asserts that the package declares no runtime dependencies.

### Package

- The root export map gains a `default` condition pointing at the same ESM entry as `import`. Resolvers
  that arrive without the `import` condition (CommonJS `require()` on Node 22.12+, `require.resolve`,
  Jest in CommonJS mode, lint import resolvers) reached `ERR_PACKAGE_PATH_NOT_EXPORTED` before; they now
  resolve `dist/index.js`. No second build is added and the package stays ESM-only. `check-package`
  asserts the condition order (`types`, `import`, `default`) and runs a CommonJS `require()` probe.

## 1.0.0-rc.1 — 2026-10-22

Local, private release candidate of the stack → Island model. No compatibility
with rc.0 is promised: see Migrating from 1.0.0-rc.0 below. Stable release readiness stays
**not ready**; nothing has been published.

### Verification

- The browser end-to-end suites are rewritten for the model: `stack`, `slider`, `accessibility`, `mobile`,
  `surface`, `harness` beside the `island` and `lab` specs (tests/README.md). They cover the
  stack, opening/collapsing, the slider, swipes and trackpad, `?fixture=attention` auto-opening on a fake
  clock, the TTL rules, overflow, RTL, the bottom edge and mobile viewports, reduced motion, axe,
  strict CSP and `timeScale` samples that prove the shell does not move during a slide.
- Installed-tarball consumers (`fixtures/integration`) and the shadcn registry check drive the pill, the
  Island, the slide, the swipe and the auto-opening action instead of the removed modes and overview.
- Documentation (package and root README, API contract, QA and release documents) describes rc.1 only.

### Motion (tuned by hand)

- `MOTION` now holds the values accepted on the laboratory: the first pill grows from scale 0.25
  with a 160 ms opacity tween (`enter.fade`), shape springs 900/60/2 (open) and 900/45/1 (close), slide
  1200/60/1, progress tween 1000 ms; tails sit 4 px apart at scale 0.9.
- A new record arriving on a visible stack keeps the shell: the title blur-swaps and the width springs to the
  new text instead of the whole pill fading out and in.
- Inside the Island only the body slides between notifications; the title and icon blur-swap in place. The
  swipe preview shows the neighbour's body under the live heading.
- Trackpad swipes commit as soon as the release threshold is crossed; the macOS momentum tail is swallowed
  (`swipe.wheelLock` 400 ms), vertical scrolling stays native, a reversed or faster delta starts a new swipe.
- Rapid body updates (progress text) change in place once a crossfade ran within `bodyQuiet` (600 ms).
- The double-click guard (`click.detail > 1`) now covers only `action`, `retry` and `cancel`; fast repeated
  clicks on close, the pill and the dots are accepted.

### Breaking changes

- One stack replaces the Island/Stack presentation modes and the overview. `ControllerSnapshot.mode`,
  `.slots` and `.queue`, `VisibleSlotSnapshot` and `PresentationMode` are removed. New:
  `ControllerSnapshot.stack` (handles, newest first) and `ControllerSnapshot.island { open, reason, current }`.
- `NotificationSnapshot.location` is now `'stack' | 'current'`; `current` is the single presented record.
- `controller.select()`, `SelectOptions` and `SelectResult` are removed. The Island is opened by the user
  from the stack or automatically by `attention`.
- `priority` no longer affects presentation order; the 3 high : 1 normal fairness queue is gone.
- The `selection-changed` event is removed. Pause reasons `queued`, `expanded` and `overview` are replaced
  by `inactive` (not presented) and `island` (current slide of an Island the user opened, or one that asks
  for action).
- `FocusTarget` drops `{ kind: 'overview' }` and `control: 'disclosure'`.
- `ToasterProps.mode` is removed. Labels `expand`, `overview`, `closeOverview`, `notificationCount` and
  `selectNotification` are replaced by `island`, `stackSummary(title, count, missed)` and `page(index, total)`.
- CSS tokens `--cloudlet-compact-*`, `--cloudlet-expanded-*`, `--cloudlet-content-padding` and
  `--cloudlet-accent` are removed; the progress bar under the icon (`.cloudlet-progress`) is replaced by a ring.

### Migrating from 1.0.0-rc.0

rc.0 had two presentation modes and an overview list; rc.1 has one stack that opens into the Island.
Applications touch only the public API below; the renderer is replaced wholesale.

| rc.0 | rc.1 |
|---|---|
| `<Toaster mode="island" \| "stack" />` | Remove the prop. The stack is collapsed or opened (`ControllerSnapshot.island`). |
| `snapshot.mode`, `snapshot.slots`, `snapshot.queue`, `VisibleSlotSnapshot`, `PresentationMode` | `snapshot.stack` (handles, newest first) and `snapshot.island { open, reason, current }`. |
| `NotificationSnapshot.location: 'queued' \| 'selected'` | `'stack' \| 'current'`; `current` is the single presented record. |
| `controller.select(handle)`, `SelectOptions`, `SelectResult` | Removed. The user opens the Island from the pill; `attention` opens it automatically. |
| `priority` ordering, the 3 high : 1 normal fairness queue | `priority` is metadata only; admission order is presentation order. |
| Event `selection-changed`; pauses `queued`, `expanded`, `overview` | Read `snapshot.island`; pauses `inactive` and `island`. |
| `requestFocus({ kind: 'overview' })`, `control: 'disclosure'` | `requestFocus({ kind: 'overflow' })` and `control: 'action' \| 'close'`. |
| Labels `expand`, `overview`, `closeOverview`, `notificationCount`, `selectNotification` | `island`, `collapse`, `stackSummary(title, count, missed)`, `page(index, total)`, `overflowCount(count)`. |
| CSS tokens `--cloudlet-compact-*`, `--cloudlet-expanded-*`, `--cloudlet-content-padding`, `--cloudlet-accent` | `--cloudlet-pill-*`, `--cloudlet-island-*`, `--cloudlet-tail-*`, `--cloudlet-badge*`; see the geometry tokens under Added. |
| Progress bar `.cloudlet-progress` | A 2 px ring around the status icon; the icon is the `progressbar`. |
| Separate overflow card | The badge, the pill name and the Island indicator line with the acknowledgement button. |

New in rc.1: `attention` on notifications and `attention.delay` on `Toaster`, `classNames`, `motion`
(`timeScale`, `overrides` for the laboratory), swipe gestures, the bottom edge and RTL mirroring described
under Added. The host attributes `data-state`, `data-island-reason`, `data-edge` and `data-dragging` are new
styling hooks; `data-position`, `data-theme` and `data-reduced-motion` are unchanged.

### Added

- `attention?: 'auto' | 'open' | 'stack'` on notification content, patches and operation content, with
  validation. Auto-open after `ControllerOptions.attentionDelay` / `ToasterProps.attention.delay`
  (default 600 ms), waiting for hover/focus/gesture, newest candidate wins, cancelled on dismiss/clear/dispose.
- Visible-time rules: only the top record (collapsed) or the current slide (Island) spends time.
- One measured shell for the collapsed pill and the Island: an SVG rounded-rect path plus the same
  `clip-path`, up to two tails and a badge, Sileo-style enter/exit, spring morph pill ↔ Island, blur swap
  of title and icon, body crossfade, horizontal slide between notifications inside a fixed shell, reduced
  motion on mount and on the fly. `ToasterProps.motion.timeScale` slows every transition (debugging aid).
- Geometry tokens `--cloudlet-pill-height`, `--cloudlet-pill-radius`, `--cloudlet-pill-max-width`,
  `--cloudlet-island-radius`, `--cloudlet-island-max-width`, `--cloudlet-tail-offset`, `--cloudlet-tail-scale`,
  `--cloudlet-badge`, `--cloudlet-badge-foreground`.
- Swipes with release physics: sideways on the collapsed pill dismisses the top record (`reason: 'swipe'`,
  the pill flies out from the release point); sideways in the Island follows the finger with the inert
  neighbour beside it, resists at the ends and navigates on release (also with a horizontal trackpad
  swipe); towards the screen edge on the Island header collapses to the stack. The axis is decided by the
  first 8 px; vertical page/body scrolling stays native; buttons and links never start a swipe; reduced
  motion turns swipes off. The host carries `data-dragging="x|y"` while a swipe owns the input.
- Missed notifications are part of the badge (shown even for one record) and of the pill name; the
  Island indicator line shows `labels.overflowCount` with the `labels.acknowledgeOverflow` button.
  `requestFocus({ kind: 'overflow' })` focuses that button, or the pill while collapsed.
- RTL mirrors the badge corner, slide direction and swipe sides. At the bottom edge the tails peek out
  upwards, the Island grows upwards from an anchored bottom and the badge sits in the bottom corner;
  `position="auto"` follows the 48rem breakpoint live.
- Island navigation counts as interaction for `attention`: a pending auto-open restarts its delay.

- The look: a light toaster on light pages and a dark one on dark pages (`theme` forces
  either; a 1 px `color-mix` border and the `--cloudlet-shadow` token keep a forced theme readable),
  `--cloudlet-success`/`-error`/`-info`/`-warning`/`-loading` in oklch, the status icon in a tinted 24 px
  circle with 16 px stroke glyphs or a spinner, a 2 px progress ring around it (pill and Island; the icon is
  the `progressbar`), 32 px action pills with a status-tinted primary action, a 32 px close circle with a
  44 px touch target, 14 px / 500 titles, and forced-colors support. `--cloudlet-tail-background` and
  `--cloudlet-tail-border` keep the stack tails visible on dark pages; the far tail lies behind the near one.
- `ToasterProps.classNames` (`Partial<Record<CloudletPart, string>>`) adds classes to the renderer parts;
  `data-kind`/`data-current` on the current card and `data-state`, `data-island-reason`, `data-position`,
  `data-edge`, `data-theme`, `data-reduced-motion`, `data-dragging` on the host are stable styling hooks.
- Debugging channel `ToasterProps.motion.overrides` (`CloudletMotionOverrides`, partial
  `CloudletMotionConstants`; `CloudletSpring`, `CloudletTimedSpring`): replaces the default springs and
  durations live for transitions started after the change; invalid fields keep their defaults. It exists
  for the laboratory and motion tuning and is not a styling API; do not ship overrides to production.

### Removed

- The separate overflow card under the stack (`.cloudlet-host > .cloudlet-overflow`).

## 1.0.0-rc.0 — 2026-10-16

Local, private release candidate. Stable release readiness is **not ready** while mandatory manual gates remain open. Nothing has been published.

- Island (default), Stack, nonmodal overview, independent controllers and generation-safe notification handles.
- Readable-time scheduler, cooperative cancellation, retries and token-safe command actions; React 18.2/19 and empty SSR/hydration support.
- Measured HTML/SVG motion without text scaling, reduced motion, native controls, semantic announcement delivery, viewport bounds and cancellable header gestures.
- External CSS/strict CSP, ESM/types/maps, installed-tarball Vite/Next and optional shadcn wrapper verification.
- Fixed thenable assimilation reading a `then` accessor twice and changing the original operation result.
- Fixed an announcement formatter unmount leaving a new timer after renderer cleanup.
- Verification now refuses a missing consumer lock unless dependency resolution is explicitly requested; RC archive/version binding is derived from the actual manifest.

VoiceOver/NVDA, real Safari/PWA/mobile devices, browser floors, physical latency/frame/memory budgets and release credentials/provenance remain unverified. Size comparisons remain report-only under the existing owner deferral; no new budget is accepted.

# Cloudlet — React notifications and operations

`@cloudlet/toast` is a notification library for React. Every notification lives in one stack, newest
first, that is either collapsed to a single pill or opened as the Island: one surface with a slider
over every notification. Activating the pill opens the Island; a notification that needs attention
opens it on its own after a short delay, without moving keyboard focus. The same controller follows
promises from pending to success or failure, with retry and cooperative cancellation.

**Status.** `1.0.0` is the first stable release; the API follows semantic versioning from here.
Screen readers, physical phones and the minimum browser versions are checked by hand on top of the
automated suite; see
[What is tested](https://cloudlet.dev/toaster/docs/accessibility#what-is-tested).

## Installation

```sh
npm install @cloudlet/toast
```

React and React DOM `^18.2.0 || ^19.0.0` are peers; use a matching pair. The package is ESM only, has
no runtime dependencies and needs neither Tailwind nor shadcn/ui. Import its CSS once, in your
application's global CSS entry or root layout.

## Minimal example

```tsx
import '@cloudlet/toast/styles.css';
import { CloudletProvider, createCloudlet, Toaster, useCloudlet } from '@cloudlet/toast';

function SaveNotice() {
  const cloudlet = useCloudlet();
  return <button onClick={() => cloudlet.show({ title: 'Saved', kind: 'success' })}>Notify</button>;
}

// The browser application bootstrap creates and owns this controller.
export function Notifications({ controller }: { controller: ReturnType<typeof createCloudlet> }) {
  return <CloudletProvider controller={controller}>
    <SaveNotice />
    <Toaster />
  </CloudletProvider>;
}
```

## Who owns the controller

Your application creates one stable controller per browser session, or one per request when rendering
on the server; never share a mutable controller between users. Creating it allocates no timers,
listeners or DOM. The Provider only passes it down, and unmounting the Toaster pauses visible time
without losing notifications or running operations. Call `controller.dispose()` once, when the owner
is permanently finished: in a React effect, clean up exactly the instance that effect created.

## Documentation

Full documentation: **https://cloudlet.dev/toaster/docs**

- Getting started: Introduction, Installation (npm and the shadcn registry item), Quick start.
- Guides: Notifications & time, Operations & cancellation, Positioning & offsets, Styling & strict
  CSP, SSR & Next.js, Accessibility (including what is and is not tested).
- Reference: `createCloudlet`, the controller, Toaster props, labels & announcements, types.
- The [changelog](CHANGELOG.md) lists every change, including migration from `1.0.0-rc.0`.

## License

Cloudlet's own code is [MIT](LICENSE). The only ported third-party code is the numeric spring and
easing of Motion 14.3.0 (MIT); it and the peer dependencies are attributed in
[THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md).

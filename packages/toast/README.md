# Cloudlet — React notifications and operations

[![npm](https://img.shields.io/npm/v/@cloudlet/toast?color=245cdb)](https://www.npmjs.com/package/@cloudlet/toast)
[![min+gzip](https://img.shields.io/badge/min%2Bgzip-9.3%20KB%20first%20load-245cdb)](https://cloudlet.dev/toaster#faq)
[![CI](https://github.com/Meerzus/cloudlet/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Meerzus/cloudlet/actions/workflows/ci.yml)
[![types](https://img.shields.io/npm/types/@cloudlet/toast)](https://www.npmjs.com/package/@cloudlet/toast)
[![license](https://img.shields.io/npm/l/@cloudlet/toast)](https://github.com/Meerzus/cloudlet/blob/main/LICENSE)

`@cloudlet/toast` is a notification library for React. Every notification lives in one stack, newest
first, that is either collapsed to a single pill or opened as the Island: one surface with a slider
over every notification. Activating the pill opens the Island; a notification that needs attention
opens it on its own after a short delay, without moving keyboard focus. The same controller follows
promises from pending to success or failure, with retry and cooperative cancellation. A notification
can carry a command, a link, or a short form of up to three text fields that is sent from the Island.

**Status.** Stable since `1.0.0`; the API follows semantic versioning.
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
- Guides: Notifications & time, Operations & cancellation, Forms, Positioning & offsets, Styling,
  SSR & Next.js, Content Security Policy, Accessibility (including what is and is not tested).
- Reference: `createCloudlet`, the controller, Toaster props, labels & announcements, types.
- The [changelog](CHANGELOG.md) lists every change, including migration from `1.0.0-rc.0`.

## Contributing and security

Issues and ideas: [GitHub issues](https://github.com/Meerzus/cloudlet/issues), with the
[contributing guide](https://github.com/Meerzus/cloudlet/blob/main/CONTRIBUTING.md) for pull
requests. Report vulnerabilities privately as described in
[SECURITY](https://github.com/Meerzus/cloudlet/blob/main/SECURITY.md).

## License

Cloudlet's own code is [MIT](LICENSE). The only ported third-party code is the numeric spring and
easing of Motion 14.3.0 (MIT); it and the peer dependencies are attributed in
[THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md).

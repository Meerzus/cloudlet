# shadcn registry

Cloudlet has a shadcn-compatible `toaster` item. It installs two application-owned files: a thin `"use client"` Provider/Toaster adapter and a CSS theme bridge. The only notification runtime is `@cloudlet/toast`; the item does not copy its controller, renderer, store, or Motion implementation. The npm library has no Tailwind or shadcn dependency.

The catalog is served from the site at `https://cloudlet.dev/r/toaster.json` (`apps/site/public/r`, copied by `registry:build`) and requests `@cloudlet/toast@1.0.0` from npm. The test below supplies that exact dependency through a temporary loopback npm test registry backed by the actual npm-pack tarball.

The catalog is [registry/registry.json](registry.json), the editable wrapper is [registry/cloudlet/toaster.tsx](cloudlet/toaster.tsx), and the stylesheet is [registry/cloudlet/toaster.css](cloudlet/toaster.css). `registry/r/` contains the built catalog/item JSON that the site serves. Schema snapshots in `registry/schema/` were fetched on 2026-10-16 from the official [catalog schema](https://ui.shadcn.com/schema/registry.json) and [item schema](https://ui.shadcn.com/schema/registry-item.json). The build validates both with Ajv 8.20.0 and the pinned shadcn 4.21.5 CLI. This follows the official [registry setup](https://ui.shadcn.com/docs/registry/getting-started) and [item dependency format](https://ui.shadcn.com/docs/registry/registry-item-json).

Run from the workspace root with Node 24.17.0 / npm 11.12.1:

```sh
npm ci --prefix registry/tooling --ignore-scripts --no-audit --no-fund
node scripts/registry-build.mjs
npm run build
node scripts/pack.mjs
node scripts/registry-check.mjs --tarball artifacts/integration/cloudlet-toast-1.1.0.tgz
```

`registry-check` creates a fresh consumer and npm cache outside the workspace, installs its committed base lockfile, confirms that `@cloudlet/toast` is absent, then runs the real pinned command `shadcn add http://127.0.0.1:<port>/r/toaster.json --yes --overwrite --cwd <consumer>`. Only the `@cloudlet` npm scope is routed to the loopback registry; all ordinary dependencies come from public npm without private credentials. The item dependency is not rewritten to a nonexistent public release. The test verifies the downloaded tarball's SHA-512 integrity, the install HTTP request, the installed lockfile's resolved URL, and a physical consumer installation rather than a workspace link. A fresh cache ensures a previous install cannot hide a missing tarball.

The clean Next App Router consumer installs React 19.3.1 / React DOM 19.3.1, Next 16.4.2, TypeScript 7.0.2 and Tailwind CSS 4.3.3 (consumer tooling only). Next App Router can use its framework-compiled React runtime; the fixture separately records the browser-observed `React.version` in every browser result instead of treating the installed npm version as proof of that runtime. The item installs into the consumer's `@/components/ui` alias, and the test checks that the only alias remains `@/*` for local application files. No alias points to Cloudlet source. The test builds production Next, typechecks installed declarations, checks server HTML before hydration, and drives the installed wrapper in Chromium/Firefox/WebKit to check the pre-provider notification in the collapsed pill, light/dark token colours on the shell path, a context action that opens the Island and closes its current slide, CSS inclusion and hydration errors. Versions and exact commands are recorded in `artifacts/integration/registry/check.json`; logs, generated files, installed package/lock and screenshots are adjacent. Pass `--keep` to retain the isolated directory for debugging. This current-browser test does not establish minimum browser versions, physical devices or assistive-technology compatibility.

The wrapper takes a controller owned by a client component. It deliberately does not create or dispose one. The controller may be `null` until that owner creates it: the children render meanwhile, also on the server, and the Toaster attaches once the controller exists. Keep the controller inside the client boundary; it is not serializable and must not be passed from a Server Component. A client owner can use an effect so Strict Mode cleanup disposes precisely the instance created by that effect:

```tsx
"use client";

import { useEffect, useState } from "react";
import {
  createCloudlet,
  useOptionalCloudlet,
  type ReactCloudletController,
} from "@cloudlet/toast";
import { Toaster } from "@/components/ui/toaster";

function SaveButton() {
  const controller = useOptionalCloudlet();
  return (
    <button
      disabled={!controller}
      onClick={() => controller?.show({ title: "Saved", kind: "success" })}
    >
      Notify
    </button>
  );
}

export function NotificationOwner() {
  const [controller, setController] = useState<ReactCloudletController | null>(null);
  useEffect(() => {
    const instance = createCloudlet();
    setController(instance);
    return () => instance.dispose();
  }, []);
  // null on the server and in the first client render: the button renders, the Toaster waits.
  return <Toaster controller={controller}><SaveButton /></Toaster>;
}
```

Mount one Toaster per controller. Separate owners create separate controllers; the item adds no singleton. Rendering Toaster on the server emits no host or notification HTML. Initial client HTML matches server output, and notifications created before Toaster mounts appear after attachment. Existing applications can instead pass their own stable controller and lifecycle owner. See the [documentation](https://cloudlet.dev/toaster/docs) for the stack, timing, handles, operations and disposal.

The wrapper explicitly imports `@cloudlet/toast/styles.css` followed by `./toaster.css`; retain that order. For Next Pages Router, where global CSS must be imported from the custom App, move those two imports into `pages/_app.tsx` in the same order and remove them from the copied wrapper. The installed item is application-owned source; this import-location adaptation is required for Pages and is separate from the App Router registry fixture.

The local CSS bridge maps modern shadcn full-color custom properties (`--popover`, `--popover-foreground`, `--muted-foreground`, `--border`, `--ring`, `--accent`, `--font-sans`) to scoped Cloudlet tokens. Define light tokens on `:root` and dark tokens on your existing `.dark` root. Pass the matching `theme="light"`/`theme="dark"` to Toaster to keep native `color-scheme` consistent; the wrapper does not install a theme provider. Older HSL-channel-only themes must wrap their values with `hsl(...)` when adapting the bridge. Tokens must be inherited by the portal container: a wrapper around your React children will not theme the default body portal. The bridge leaves forced-color media styling to the library and does not change Cloudlet's success/loading accent. Its selectors target Cloudlet hosts only.

All public Toaster options pass through unchanged, including `position`, `theme`, `dir`, `container`, `offsets`, `nonce`, `labels`, `announcements`, `attention`, `classNames` and `motion`. For strict CSP, keep CSS external and pass the request nonce to `nonce` for Cloudlet's geometry stylesheet. This adapter adds no inline style attribute or style block of its own; the library's production CSP fixture covers the morph, slides, swipes and progress under the enforced policy. Follow the documentation's SSR & Next.js and Content Security Policy guides when integrating Next's own script/style nonces.

The wrapper and local CSS are original MIT-licensed project code. They include no copied third-party controller/renderer code. The pinned shadcn/Ajv/Tailwind/Next packages are verification tools and consumer dependencies; they are not shipped inside the npm library or copied into its runtime. The official JSON schema snapshots retain the upstream MIT notice in `registry/schema/LICENSE.shadcn-ui` and are sourced from the MIT-licensed [shadcn/ui repository](https://github.com/shadcn-ui/ui), and their original content is retained.

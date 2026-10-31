# Security policy

## Supported versions

Security fixes land in the latest minor release of `@cloudlet/toast` and ship as a patch. Older
minors are not patched; upgrading within `1.x` is non-breaking.

| Version | Supported |
|---|---|
| `1.x`, latest minor | Yes |
| Older `1.x` minors | Upgrade to the latest minor |
| `1.0.0-rc.*` | No |

## Reporting a vulnerability

Please do not open a public issue. Report it privately through GitHub:
**[Report a vulnerability](https://github.com/Meerzus/cloudlet/security/advisories/new)**
(the Security tab of this repository).

Include what you can of:

- the affected version and environment (browser, framework, React version);
- the steps or a minimal reproduction;
- the impact you see, for example script injection through notification content or a bypass of a
  strict Content Security Policy.

You can expect an acknowledgement within five working days and an assessment within two weeks.
Once a fix is released, the advisory is published with credit to the reporter, unless you prefer to
stay anonymous.

## Scope

- The `@cloudlet/toast` package: its runtime, its stylesheet and the published archive.
- The shadcn registry item in [`registry`](registry).
- The website at cloudlet.dev, including its Playground and documentation.

Content your application passes to Cloudlet stays your responsibility: rich descriptions and icons
are React nodes, and rendering untrusted markup in them is outside Cloudlet's control. The
[Content Security Policy guide](https://cloudlet.dev/toaster/docs/csp) lists what Cloudlet itself
needs from a strict policy.

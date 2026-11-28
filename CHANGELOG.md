# Changelog

Every package keeps its own changelog, and the archive published to npm ships it:

- [`@cloudlet/toast`](packages/toast/CHANGELOG.md), the Toaster, including migration from
  `1.0.0-rc.0`.
- [`@cloudlet/agent`](packages/agent/CHANGELOG.md), the kit's agent bridge (experimental).
- The website and the shadcn registry items, which have no npm package:
  [apps/site/CHANGELOG.md](apps/site/CHANGELOG.md).

A release tag names its package and version: `toast-vX.Y.Z` or `agent-vX.Y.Z`, with `-rc.N` for a
prerelease. The GitHub Release of a tag carries that version's section of the package's changelog.
Tags up to and including `v1.3.0` are releases of `@cloudlet/toast`.

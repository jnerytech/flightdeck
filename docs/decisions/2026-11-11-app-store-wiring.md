# The store's slice wiring moves into one file per domain behind a kernel port (issue #1596)

## Context

`apps/desktop/src/lib/app-store.ts` is 2488 lines after its types moved to `lib/app-state.ts`.
About 650 of them are the constructor: it builds some 50 slices, and each one gets a port made of
lambdas over the store (`state: () => this.state`, `update: (patch) => this.update(patch)`,
`list: (hostId) => this.hostCommand(hostId, "ssh.list", {})`, ...). Those lambdas are knowledge of
the domain (which host command it sends, which option it reads), yet they sit in the composition
root: a change to the `ssh.list` command edits `app-store.ts`, and the file cannot fall under the
800 lines of #1589 while it holds them. The other large share (about 170 lines) is 22 methods that
only forward to a slice; fd-coordinator decided on 2026-11-11 that screens bind the slices directly
(`store.<slice>.x`) and those methods go, one PR per screen (fd-frontend).

## Decision

- A domain that has a slice also has `features/<domain>/wire.ts`: one function,
  `wire<Domain>(kernel, deps): <Domain>Slice`, that builds the slice's port from a kernel and, when
  the slice needs another slice, from `deps`. The slice and its port type stay as they are.
- `lib/kernel.ts` defines `AppKernel<S>`, the narrow part of the store every wire file may use:
  `state()`, `update(patch)`, `hostCommand`, `hostRequest` and `connection(hostId)`. `S` is the
  state the slice reads (the store passes `AppState`, a wire file names its slice's), so the file
  imports neither the app state nor a feature and a wire file depending on it creates no cycle;
  `HostCommandType` and `HostResult` live there too. A need that is not in the kernel stays a `deps` argument typed by the slice it names
  (`wireQuota(kernel, { inbox })`): the constructor keeps the construction order, the wire file
  keeps the lambdas.
- `AppStore` holds its `AppKernel` as a private object (so `update` stays private to the store) and
  its constructor reads as a list: `this.ssh = wireSsh(this.kernel)`. A kernel method joins
  `lib/kernel.ts` with the first wire file that uses it (`onlineHosts()` comes with quota).
  It stays the composition root (it builds, orders and disposes the slices, and owns `update`'s
  cross-domain side effects); it no longer knows what a domain asks of a host.
- One domain per PR, structure only. A wire file of a few lines may share a PR with the next
  domain's when both moves are mechanical (fd-coordinator agrees per PR). A domain's existing
  slice and store tests are the safety net; a wire file has no test of its own (it holds no rule).
- A wire file stays under about 60 lines. If it grows past that, the port is too wide and the
  slice has two responsibilities.

## Discarded

- **One `lib/app-store-wiring.ts` with every lambda.** Mechanical, but the 650 lines only change
  address: a file that changes with every domain, which is what #1589 asks to avoid.
- **Slices take the whole kernel and drop their ports.** Fewer lambdas, but each slice could reach
  anything, its tests would need a fake of the whole kernel, and the "narrow port" rule of
  `2026-11-10-app-store-slices.md` would go.
- **Leave the constructor as it is.** The rules of #1589 and the 800-line goal of #1596 cannot be
  met, and every new slice adds its lambdas to the same file.

## Consequences

- `app-store.ts` falls by about 550 lines with the wiring and by about 170 with the forwarders: near
  1750. What remains is logic that talks to several slices at once (`connect`, `onStatus`,
  `loadHostInfo`, the notices, the tabs). Under 800 needs that hub split too, as its own decision
  once the wiring is out; this ADR does not promise it.
- `AppKernel` is a new public type of the store. It must stay small: a method is added only when
  two domains need it, and a domain-specific need goes to `deps`.
- A slice built in a wire file is still built once per store, in the same order as today, so
  `dispose` and the start-up order do not change.
- Slices that need the `connections` map directly (account, terminal) use `kernel.connection(hostId)`
  and keep their own narrow stream type.

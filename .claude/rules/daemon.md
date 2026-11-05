---
paths:
  - "apps/daemon/**"
---

# The daemon (apps/daemon)

- Runtime code never blocks on IO: no synchronous node or Bun call. The no-sync ratchet counts
  them per file (`SYNC_BASELINE`), and it only goes down.
- Executables are looked up with `whichOnPath` (`apps/daemon/src/which.ts`). `Bun.which(name)`
  without options reads the PATH from when the process started, and escapes the test lock.
- Services (`systemctl`, `schtasks`, `loginctl`) go through an injected context; tests never run
  them. A server in a test asks for port 0: the fixed-port ratchet refuses the real daemon's
  ports (7420 to 7429).
- Logic that decides is a function that takes its effects (git, fs, clock, spawn, network) as an
  injected context or deps object; the command handler only wires the real ones. Tests pass fakes,
  not `mock.module`.
- Nothing about money reaches the daemon (`no-money`): it keeps counts, tokens and the cost the
  agents ran up, never a rate or a price.

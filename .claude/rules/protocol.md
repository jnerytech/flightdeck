---
paths:
  - "packages/protocol/**"
---

# The protocol between the app and the daemon (packages/protocol)

- Changes are additive: a new command, or a new optional field. Never remove or rename a command
  or a field, and never make an optional field required: apps and daemons of different versions
  talk to each other (`PROTOCOL_VERSION`, `MIN_PROTOCOL_VERSION`).
- Every refusal carries its reason (`refusals.ts`). The refusal ratchet counts the daemon's
  `FlightdeckError` calls with no reason, and it only goes down.
- The product version is the same in the protocol, the daemon, the desktop and `tauri.conf.json`.
  A test checks it; change it only with the `test(versao)` cycle, at release.
- No token, secret or money value travels through it: the vault and the actions keep secrets
  between the app and the daemon, and nothing about money reaches a daemon (`no-money`).

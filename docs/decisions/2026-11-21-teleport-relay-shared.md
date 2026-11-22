# The teleport relay lives in the protocol package, shared by the app and the CLI (issue #3704)

`flightdeckd session teleport` has to run the same relay as the app: ask the source for a package, check
its manifest, open the target's inbox, move the parts chunk by chunk, import, and clean both hosts. The
relay was in `apps/desktop/src/features/teleport/teleport.ts`, which the daemon cannot import.

Decision: the relay moves, with no change in behavior, to `packages/protocol/src/teleport-relay.ts` and
is exported from the package entry. The package already holds a little pure logic with no I/O of its own
(`sequence.ts`, the secret scanner), both apps already depend on it, and it adds no workspace, no
lockfile change and no import cycle. A new workspace folder or a daemon package imported by the desktop
would have added machinery for one 250-line file.

Two things stay with each caller:

- The two hosts' command channels (`TeleportRequest`): the app's connections, the CLI's two daemon clients.
- The refusal: the relay takes `refuse(reason)` and throws what it returns, so the app keeps its
  `RequestError` (with the reason it translates) and the CLI gives the `--host` refusal text.

The relay's types name the commands it sends (`TeleportCommands`) and do not import the package entry, so
there is no cycle. `apps/desktop/src/features/teleport/teleport.ts` re-exports the moved names and keeps
`isPlainRemote` and `SessionMover`, so the app's tests and screens are unchanged.

# Moving a session to another host from a shell (issue #3704)

`session teleport <session> --to <host> --repo <path> [--confirm]` moves an idle session as the app's Teleport
dialog does, over the same seven `teleport.*` commands. The relay (prepare, check the manifest, receive, read and write
chunk by chunk, finish, clean up both hosts, archive the source copy) is one function in `packages/protocol`
(`2026-11-21-teleport-relay-shared.md`); the verb adds only the two connections, the confirmation and the words.

- The source is the local daemon, or the host `--host` names; the target is `--to`. Both go through `resolveHost`, so a
  plain `ws://` address that is not a private one is refused before anything is asked, and a token is never printed
  (the target's is scrubbed from every line the verb prints).
- Nothing moves without `--confirm`: the same summary the dialog shows is printed, the source's package is dropped and the exit
  is `1` (`reason` `not_confirmed`). A session that is not idle, is in a team or is not Claude's is refused by the
  source's `teleport.prepare` with its reason, worded for a person.
- A refusal by either host, a source package that does not hold together or stops early, and a Ctrl-C leave nothing on
  either host (the relay's clean-up: `teleport.abort` on the target, `teleport.cancel` on the source) and exit `1`. A host
  that does not answer or is not there exits `2`. A silent `teleport.finish` exits `1` and says the session may or may not exist
  on the target, and the source copy is not archived: a person looks before moving again.
- Risk: `session teleport` is rated high from a session's shell, since it copies a session's transcript and code to another
  host and archives it here.
- Open (not decided here): the verb adds no refusal for a package whose lines look like secrets; it prints their count and
  kinds before the move, as the dialog does, and `--confirm` is the person's yes.

# A CLI command can stream: `board watch` keeps one connection open (issue #3454)

## Context

Every `flightdeckd <noun> <verb>` so far asks the daemon one thing and prints one answer
(`runOnLocalDaemon`, `daemon-client/cli.ts`): connect, one time limit over the whole run, exit 0, 1 or 2.
The app's `board.watch` is different: the daemon acks it and then keeps pushing `card.updated` frames
until the socket closes. CLI first (#3423) needs that verb too, for a script or a person who wants the
board's changes in a terminal. Three things in the one-shot runner do not fit a stream: the clock covers
the whole run, the token is scrubbed from the lines only at the end (a streamed line is already on the
screen by then), and `DaemonClient` reads only pings and acks.

## Decision

`board watch` reuses the same runner and the same client, with three small additions:

1. The runner's clock covers the connect and the `board.watch` ack only. `perform` gets a third
   argument, `flow`, with `started()` (stops the clock: the stream may now last as long as it wants)
   and `hide(text)` (the same token scrub the runner applies to the final lines).
2. Every streamed line goes through `flow.hide` and the terminal-control scrub of the other commands
   before it is written. Errors still go through `explain` and `explainRemote`, so a `--host` target
   fails the same way as any other command.
3. `DaemonClient` gets `onFrame(type, listener)`, registered before the request is sent so no frame
   between the ack and the listener is lost, and `closed`, a promise of the close code.

The command stops through an injected `AbortSignal` and writes through an injected port: `commands.ts`
wires `deps.onSignal("SIGINT")` and `deps.log.log`, so the tests need neither a signal nor a terminal.
Exit codes: Ctrl-C 0, the daemon refusing the watch 1, the socket closing mid-stream 2 (a read: no
"may or may not have" text). `--json` prints one card per line (NDJSON); text prints the line of
`card list`. There is no `--follow`: a stream until Ctrl-C is the only mode.

## Alternatives discarded

- **Poll `board.get` in a loop.** Simple, but it misses a card that changes twice between two polls and
  costs a full board read per tick; the daemon already pushes the change.
- **A very large `timeoutMs` for the one-shot runner.** It keeps the old runner untouched, but a stream
  that stalls after the ack would then be indistinguishable from a healthy one, and the connect would
  wait as long as the stream.
- **A separate client class for streams.** Two connect paths would fork the token handling, the loopback
  check and the error mapping that every command shares; the fork is where a token leak would hide.

## Consequences

- Later streaming verbs (a session's output, the requests queue) reuse `flow`, `onFrame` and `closed`.
- The one-shot commands do not change: `flow` is an extra argument they ignore.
- `board watch` is a read, so the permission rating leaves it alone.

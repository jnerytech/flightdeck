# `webhook.send` stays in the app (issue #3459)

## Context

`webhook.send` posts a webhook from the host. Its payload is `url`, `headers` and `body`, and the URL is a
vault secret: the app gets it from the vault and hands it to the daemon for that one post, and the daemon never
stores or logs it. The CLI-first rule (#3423) asks whether this command gets a `flightdeckd webhook send` verb.

## Decision

`webhook.send` gets the parity row `{ "appOnly": "<reason>" }`, with no verb.

A verb would have to receive the URL. The command takes the URL itself, not a secret id, and delivering a vault
value is app-only (`vault.deliver`, #3458). So the CLI could take it only as a flag, from stdin or from a file, and
each of those puts a vault secret where a shell history, a process list or a session's transcript keeps it. A flag
for a secret id would need the daemon to look the value up and post by itself, which is a daemon change
(a new request, and a new rule on what a session may post), not a CLI slice.

## Discarded alternatives

- **`webhook send --url <text>`:** puts the secret in the argument list and the history. Refused.
- **`webhook send --secret <id>` over the existing request:** the CLI cannot read the value, so it cannot fill
  `url`.
- **`webhook send --secret <id>` with a daemon lookup:** a daemon change that lets any token holder post to a
  stored URL with a body it chooses. It needs its own decision and the approval gate; no issue asks for it.

## Consequences

The parity baseline drops by one, the commands chapter of both manuals says the command is app-only, and the app
keeps calling the same daemon request. If a use appears (a script that must notify a webhook), it opens an issue
for the daemon-side lookup first.

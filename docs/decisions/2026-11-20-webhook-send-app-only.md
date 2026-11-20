# `webhook.send` stays in the app (issue #3459)

## Context

`webhook.send` posts a webhook from the host. Its payload is `url`, `headers` and `body`, and the URL is a
vault secret: Slack and Discord put the token in it. The app holds it, hands it to the daemon for that one post,
and the daemon logs only the refusal reason, never the URL. `webhook.send` does not use the daemon's `Vault`
class: the URL travels in the request, and only the transport check (`requireVaultTransport`) is shared. The
CLI-first rule (#3423) asks whether this command gets a `flightdeckd webhook send` verb.

## Decision

`webhook.send` gets the parity row `{ "appOnly": "<reason>" }`, with no verb.

Two reasons, in order of weight:

1. **A session runs the CLI.** A verb would let a Claude session in a shell post a body of its choice to a public
   https address, with the URL in its own transcript. Today the person's app is the one place that decides to post.
2. **The CLI has no vault.** The command takes the URL itself, not a secret id, so the person would have to paste a
   secret they already hold: as an argument (shell history, process list), from stdin or from a file.

## Discarded alternatives

- **`webhook send --url <text>`:** puts the secret in the argument list and the history. Refused.
- **`webhook send --secret <id>` over the existing request:** the CLI cannot read a vault value, so it cannot fill
  `url`.
- **`webhook send --secret <id>` with a daemon-side lookup:** the right home is the existing `vault.use` path
  (a delivered value, a purpose and the approval gate), not a new open request; it is a daemon change that needs
  its own decision, and no issue asks for it.

## Consequences

`app-only` marks the command as outside the CLI; it does not close it to other clients. Any WebSocket client on
loopback or Tailscale that holds the token can still send `webhook.send`, within the sender's limits (headers
restricted, redirects refused, address pinned against DNS rebinding, body capped at 100 kB). The parity baseline
drops by one, the commands chapter of both manuals says the command is app-only, and the app keeps calling the
same daemon request. If a script must notify a webhook, it opens an issue for the daemon-side lookup first.

# Phone notices through an ntfy webhook type (issue #263)

**Context.** The owner chose option A of #167: phone notices stay one-way, as a fourth webhook type
next to Slack, Discord and generic. The app formats each webhook and the daemon sends it
(`webhook.send`). The daemon refuses a private or loopback destination over https, and it passes
only `content-type` and `x-flightdeck-*` headers. A webhook leaves only while the desktop app is
open.

**Decision.**
- A target of type `ntfy` takes a topic URL (`https://ntfy.sh/my-topic`, or a self-hosted server
  plus topic) and an optional access token. The app splits the URL into the server's origin and the
  topic (`[A-Za-z0-9_-]{1,64}`, one path segment). It publishes with ntfy's JSON form: a POST to the
  server's root with `{ topic, title, message, priority, tags }`. The topic and the token are kept in
  the vault, as the other types' URLs and secrets are.
- Priority by kind: `needs_you` is 4 (high); every other kind is 3 (default). There is no `click`
  and no `actions`: a tap on the phone opens nothing in the app.
- The token travels as `Authorization: Bearer <token>`. The daemon accepts that one more header,
  and only in that shape: `Bearer`, then 1 to 200 characters of `[A-Za-z0-9_-]`. Like the URL, it
  never reaches a log line or a refusal.
- Tests run against a fake ntfy server on loopback, never a real one.

**Alternatives discarded.**
- *Topic URL with a text body and ntfy's `Title`/`Priority` headers.* The daemon would have to pass
  arbitrary headers. The JSON form needs one header (`Authorization`), and only when there is a
  token.
- *The token in the URL (`?auth=`).* That needs no daemon change, but the token would then sit in
  the server's access logs and in any proxy's. A header keeps it out of the URL.
- *Allowing private addresses for a self-hosted ntfy on the LAN.* That would lift the daemon's SSRF
  guard for every webhook type. A server on a private network is not reachable for now; the manual
  says so.

**Consequences.** One small change in the daemon's header rule, one formatter and one target form
in the app, the type's words in both languages, and a manual section. The notices stop while the
app is closed; the manual says so.

**Security review (2026-11-06).** No high or medium. Changed: a target switched to ntfy drops
the generic type's signing secret unless a token comes with it, since that secret would go out
as a Bearer and fail on every post. Left as they are: the daemon resolves the host once to check
it and `fetch` resolves it again. That DNS-rebinding window existed for every webhook before, and
the token now rides in it; pinning the resolved address is a change to the sender for all types,
tracked separately. And a compromised webview could already send any body to any public host
through `webhook.send`; the Bearer header adds only a header it could choose.

# Session summary and webhooks

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/session-summary-and-webhooks.md)

A terminal session's page shows a short **summary**, and the app can post a message to **Slack,
Discord or any HTTPS endpoint** when something needs you.

## The summary

- It is built by the host from the session's transcript, **with no model call**, so it costs
  nothing: what was **asked** (your first real prompt), what was **done** (Claude's last text), the
  **files** it edited or wrote (at most 12, then "and N more"), the **cost** (from the usage the
  host already indexed) and the **open question** when a request is waiting.
- Each field is cut to a fixed size. A field that holds a secret (a token, a key, a password typed
  on the line, a vault value) is replaced by `[secret hidden]`, in the app and in every message.
- **Copy summary** puts the lines on the clipboard. A host without the feature shows no panel.
- It is a card in the session's header: **open the first time** you see a session, then **folded to
  one line** (the done text, cut) until you open it with the arrow. It pushes the conversation down and never overlaps it.
- It shows on terminal sessions and on the sessions Flightdeck starts (once Claude Code has named the session).

## Webhooks

Open **Settings → Webhooks**.

- **Add a webhook:** a name, a type, the address, the hosts and the events.
  - **Slack:** an incoming webhook (`https://hooks.slack.com/services/...`).
  - **Discord:** a channel webhook (`https://discord.com/api/webhooks/...`). Nobody is pinged by a
    session title.
  - **Generic JSON:** your own endpoint, with a **signing secret**.
  - **ntfy (phone notices):** the address of one topic (`https://ntfy.sh/your-topic`, or your own
    server's) and, for a protected topic, an **access token** (`tk_...`), kept in the vault. Install
    the ntfy app on the phone and subscribe to the same topic. *Needs you* arrives with high
    priority, everything else with the default one. The notices go one way: a tap opens nothing in
    Flightdeck. The server must be reachable from the internet; one only on your home network is
    refused, as for every webhook. Pick a topic name nobody would guess, or protect it with a token:
    anyone who knows a public topic can read it.
- **Events:** *needs you* (a permission or a question), *session ended*, *session failed*, *budget
  alert* and *PR watch* (a watched PR needs you). Each webhook picks the ones it wants.
- **Hosts:** *all hosts*, or one. An event from a host goes to the webhooks of all hosts and to that
  host's.
- **The address is a secret.** It is kept in the vault, never in the settings, a log, an export or a
  print. The list shows only the host it sends to (`hooks.slack.com`). On *Edit*, an empty address
  field keeps the current one. Removing a webhook deletes its secret.
- **Test** sends a sample message once and shows the HTTP status and the time, never the answer's
  body. A good test also gives a stopped webhook a fresh start.
- **Only while the app runs.** Webhooks are sent by the app, because the vault is the app's. If the
  app is closed nothing is sent, and the screen says so. They also need one online host: the app
  hands the address to it for that one post, over the vault's transport (loopback or Tailscale), and
  the host never stores or logs it.

**How it sends.** One message at a time per webhook, at most one per second. Several events of the
same kind that wait together become one message ("3 × needs you"). A network error, a timeout, a
`5xx` or a `429` is retried after 2 s, 8 s and 32 s (more if the receiver sent `Retry-After`), up to
four tries. Any other `4xx` or a redirect stops the webhook at once and marks it *failing*, with the
status: fix the address, or press Test or Edit, to start again. At most 100 messages wait per
webhook; the oldest are dropped.

**What the host refuses.** The host posts only to `https://` addresses (plain `http://` only to
`localhost`, `127.0.0.1` or `[::1]`), without a user or password in the address, without following a
redirect, with a 10-second limit, and **never to a private, loopback, link-local, shared (100.64/10)
or reserved address** after resolving the name. Such a request counts as a permanent failure (shown
as HTTP 400). Only `Content-Type` and `X-Flightdeck-*` headers go out, and a body is at most 100 KB.
One limit: the name is checked, then connected to; a receiver that changes its DNS answer between
the two is not caught.

**The generic message.** A `POST` of JSON: `id`, `kind`, `host`, `project`, `title`, `at`, `detail`
and `summary`. The headers carry the event (`X-Flightdeck-Event`), a unique id to ignore repeats
(`X-Flightdeck-Delivery`), the time in Unix seconds (`X-Flightdeck-Timestamp`) and the signature
`X-Flightdeck-Signature: sha256=<hex>`, the HMAC-SHA256 of `<timestamp>.<body>` with your signing
secret. To verify: recompute it from the raw body, compare in constant time, and refuse a timestamp
older than five minutes (so a captured message cannot be replayed).

```js
const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
const fresh = Math.abs(Date.now() / 1000 - Number(timestamp)) < 300;
const ok = fresh && timingSafeEqual(Buffer.from(signature), Buffer.from(`sha256=${expected}`));
```

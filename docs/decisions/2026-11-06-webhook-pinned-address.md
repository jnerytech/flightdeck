# A webhook connects to the address its check approved (issue #465)

**Context.** The daemon's webhook sender resolved a target's name to check that every address is
public (or loopback for `http://localhost`), and then `fetch` resolved the name again. A name that
answers a public address to the check and a private one to the second lookup (DNS rebinding) got the
request, body and headers included; since #263 the headers can carry an ntfy access token.

**Decision.** One lookup. The request goes to the first address the check approved: the URL's host
is replaced by that address (an IPv6 one in brackets). The name stays in `Host` (with the port when
it is not the default), and over https in the TLS server name (`tls.serverName`), so the
certificate is still verified for the name. There are still no redirects, so the answer cannot send
the request anywhere else.

**Alternatives discarded.** A custom DNS lookup hook for `fetch`: Bun's `fetch` has none. A
dispatcher or agent per request (undici, `node:https` with `lookup`): a second HTTP client in the
daemon for one call site. Checking again after the request: too late, the request would have gone.

**Consequences.** A server that serves several names on one address still gets the right one
through `Host` and SNI. A name with several addresses uses the first that was checked, with no
fallback to the others: a webhook either goes through or is retried by the app's queue.

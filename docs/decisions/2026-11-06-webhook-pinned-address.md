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

**Evidence that the name is still verified (Bun 1.4.4, 2026-11-06).** A local `Bun.serve` over TLS
on `127.0.0.1` with a self-signed certificate for `hooks.example.test`, fetched at
`https://127.0.0.1:<port>/` with the certificate as `ca`: `tls.serverName: "hooks.example.test"`
answered 200 and the server saw `Host: hooks.example.test`; `serverName: "other.example.test"` and
no `serverName` were refused with `ERR_TLS_CERT_ALTNAME_INVALID`; the right name without the `ca`
was refused with `DEPTH_ZERO_SELF_SIGNED_CERT`. So `serverName` sets what the certificate is
checked against, and `rejectUnauthorized` stays on by default. This is not a test in the suite: it
would need a private key in the repository or `openssl` on every CI runner. The unit tests pin
what the sender passes (`serverName` for a name, none for an address written in the URL).

**Security review (2026-11-06).** The rebinding window is closed: `fetch` gets an address, so it
makes no lookup, and `redirect: "manual"` stops a hop to another name. Changed after the review: an
IPv4 address is pinned first (a loopback name also answers `::1`), and an address written in the
URL gets no server name (SNI carries names only).

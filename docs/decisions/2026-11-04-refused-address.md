# A refused address (issue #106, follow-up)

- **The doctor names the cause; the app can only hint.** The origin filter answers 403 before any upgrade, and a browser
  WebSocket reports only that it closed, so the app sees the same close as for a daemon that is down. Telling them apart in the
  app would need either an HTTP probe (the webview's CSP allows no `http:` in `connect-src`, and widening it lets any injected
  script talk out over plain HTTP) or an upgrade that closes with a code (it would end the guarantee, tested in `redes`, that a
  refused address gets no handshake at all). Neither is worth it for a message, so the app shows a hint for a refused connection
  to a non-loopback host: "or the daemon refused this machine's address ... allowedNetworks".
- **The 403 now says the address** (`forbidden: <ip>`, the client's own address, which it already has), so `flightdeckd doctor`
  reads it from `/health` and reports "the daemon refused this machine's address (<ip>)" as a failure, with the setup fix.

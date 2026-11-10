# Remote access over Tailscale

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/remote-access-over-tailscale.md)

By default only loopback connections are accepted (`allowedNetworks`:
`["127.0.0.0/8", "::1/128"]`); any other origin gets HTTP 403 before the WebSocket, on every
route. To use the tailnet, set `bind` to the tailnet IP (or `0.0.0.0`) and allow the Tailscale
ranges:

```json
"bind": "0.0.0.0",
"allowedNetworks": ["127.0.0.0/8", "::1/128", "100.64.0.0/10", "fd7a:115c:a1e0::/48"]
```

There is no TLS of its own: Tailscale's WireGuard tunnel encrypts the traffic. **Exposing the
port on the open internet is not supported.**

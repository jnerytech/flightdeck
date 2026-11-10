# Pairing

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/pairing.md)

```sh
flightdeckd pair            # prints flightdeck://<ip>:<port>?name=…&token=… and the QR code
flightdeckd pair --rotate   # generates a new token; the running daemon drops whoever used the old one
```

The address is what the daemon listens on: `bind`, or the Tailscale IP (`tailscale ip -4`) when
the daemon listens on every interface. A daemon on the loopback gets a `127.0.0.1` link plus a
hint on how to open it to Tailscale, because a link with the Tailscale IP would not connect. In the
app, paste the link into **Add host** or open it directly (`flightdeck://` is registered with the
system); the app fills in the form, tests the connection with `hello` and `host.info`, and only
saves after you confirm.

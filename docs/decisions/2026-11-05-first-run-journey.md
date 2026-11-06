# First run, journey J1 (issue #184)

- **Done.** The probe of "Test and add" gives up after 8 s with a message that names the cause. A pairing link that is refused comes from the protocol as a code (`scheme`, `address`, `port`, `token`) and the app words it from the dictionaries, so the English app no longer shows Portuguese. An empty window with no host offers "Add a host". The e2e journey `primeira-vez` pastes two bad links and checks the catalog text (it was not run on the Pi; CI runs it).
- **Pair again.** When the host refused the token, the notice on the host's page has a field for a new pairing link or token and a "Pair again" button: it tests the host with the new token, then keeps the same host (no duplicate) and reconnects. There is no e2e journey for it (the demo has no host that refuses its token).
- **Not done yet.** The host page checklist (#164) and the reason on the disabled Board, Workflows and History entries.

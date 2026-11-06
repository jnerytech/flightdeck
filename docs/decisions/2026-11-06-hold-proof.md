# The host asks for the hold (issue #251)

- **Protocol.** `permission.respond` takes an additive `held: boolean`. An allow of a high-risk request without `held: true` is refused with the code `invalid_state` and the reason `hold_required`; the request stays open. A deny, and an allow of a low or medium request, never need it. The host announces the check as the feature `hold-proof`.
- **Old app, new host.** An app that predates the field works as before except for a high-risk allow, which the host refuses with a reason an old app shows as the daemon's message. A new app against an old host sends `held` and the old host ignores it (the app still checks the hold itself, #245).
- **External sessions (decision).** The earlier note that external requests carry no risk is out of date: the hook path classifies every request (`ExternalPermissions.hold`) and the frame carries `risk`. So an external high-risk request is held to the same rule, checked on the frame the daemon kept, before the hook is answered. A request the daemon never classified (a frame without `risk`) counts as low.
- **Not covered.** Automatic approval is not a `permission.respond` and keeps its own rule (a high-risk request always comes to the person). The smokes answer only Write and `npm test` requests, which are not high risk.
- **Known limits (security review, nothing high).** `held: true` is the client's own statement, not
  authentication: it stops an old app, a script or a caller that forgot the hold, not a client that
  lies. The two ways a high-risk action can still run without a hold are older than this change and
  are #384: an `updatedInput` that swaps the command after the risk was judged, and a blanket
  `addRules allow` for a tool saved from a request of lower risk. The external path reads
  `risk ?? "low"` for a frame without a risk, which `hold()` never produces; #384 makes it fail
  closed. The app does not read the `hold-proof` feature (a new app against an old host relies on
  its own check, #245).

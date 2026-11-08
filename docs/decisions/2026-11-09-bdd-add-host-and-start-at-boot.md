# BDD: the Add host guide and Start at boot (issue #1199, #1200)

## Context

fd-coordinator asked for `.feature` files for what shipped after round 4. This slice covers the
first-run guide on the Add a host page (#1199) and Start at boot from the host's health (#1200).

## Decision

- `add-host-guide.feature`: with hosts already added, the Add a host page lists the four first
  steps with Copy buttons for `flightdeckd setup` and `flightdeckd doctor`; the four manual fields
  are folded away while the pairing link stays in view; a pasted pairing link opens the fold on its
  name. Nothing is saved, so the scenarios leave no state. About 10 s each.
- `start-at-boot.feature`: the host page's Service row of a host that runs from source says it is
  missing, shows `flightdeckd service install` to run by hand, and offers no Turn it on.
  - The demo daemon runs from source, and `appCanInstallService` refuses a daemon that is not the
    stable binary, on purpose (the install would touch the machine's service manager). So the
    **Turn it on** click is not a scenario: it stays in the component and daemon tests
    (`host-health-ui`, `service-from-app`), which use a fake service manager.
  - `scripts/demo-seed.ts` now gives the demo daemon `serviceInstalled: false` and linger on, so the
    row reads the same on every machine (it asked the real service manager before).
- The two features go red when their key step is cut (no pasted link; the absence check inverted).

## Not covered

The connected host's Turn it on and its result line, and the offline host's variant: both need a
daemon that is the installed binary, or a seam that fakes `appCanInstallService`, which would
weaken the guard for the demo.

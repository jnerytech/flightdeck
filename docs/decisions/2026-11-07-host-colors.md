# A host has one of eight colors, picked by a hash of its id (issue #644)

Every host shows the same color wherever it appears, so the person tells hosts apart without
reading the name each time.

- `lib/host-color.ts` hashes the host id (FNV-1a) into one of eight tokens, `--host-1` to
  `--host-8`. The same id gets the same color on every window and every run, with nothing stored:
  no setting to keep in sync and no color to choose.
- The tokens are in `styles.css` for both themes and keep 3:1 against the background, the cards,
  the popovers and the sidebar (`host-color.test.ts` measures it). They are not the client colors:
  those are the same in both themes and are not held to 3:1.
- `HostDot` is the dot. It sits in the top bar's switcher (the button and each host of its menu) and
  in the list of all tabs. A host's tab has a 2 px line on top in its color, selected or not; the
  selected tab's accent line takes the host's color. Shared tabs have no host and keep the accent.
- The color is never the only sign: the dot is hidden from assistive technology and the host's name
  stands beside it.
- Two hosts can share a color (eight colors, any number of hosts). The name is what tells them
  apart then.
- Still to come in #644: the dot in the shared lists (Sessions, Needs you), host names out of the
  tab titles, the compact tab button, and the All hosts row.

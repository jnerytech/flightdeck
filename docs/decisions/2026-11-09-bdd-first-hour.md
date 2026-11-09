# BDD: the first hour, from first start to the first PR (issue #1562, for #168 round 14)

## Context

UX round 14 (#168) walked a new person's first hour and filed #1543 to #1551. No journey held that
walk whole: the first-run screen, pairing, the first project, card and PR were each tested apart.

## Decision

`first-hour.feature`, eight scenarios (en and pt-BR, 2 to 35 s each on the Pi), all on the page a first
start opens (`?hosts=none`, #1052). The page is never reloaded after the pairing: the web build keeps
the host's token in memory only, so a reload would lose it, which is also why these scenarios use their
own in-page steps instead of the `open()` helper.

- **A first start** names "Connect your first host", lists the four first steps with the copy buttons
  and folds the manual fields away behind the pairing link.
- **Pairing.** The seed now hands the first demo host's address, port and token to the scenarios
  (`ids.alfaPairing`), so a real pairing link is pasted and "Test and add" connects a real host: its
  dot in the sidebar reads online. The host is named by the link.
- **The first card.** A repository of the scenario's own is added from the host page, its board opened
  from the project page, and a card whose description is `[commit]` started; Needs you lists it as
  finished, under the host's name.
- **Open PR.** With a remote and GitHub chosen as the PR host in the project's settings, Open PR shows
  the PR's title and description to read first, "Open the PR with this text" opens it, and the card says
  the PR is open and offers Merge PR.

Mutations, each red for the right reason: a wrong token in the link (no "orange pi: online"); the PR
host set to none in the settings step (the card never says "PR open"); the card's description
`[quiet]` (the run never ends, so the card never reaches Review changes or Open PR).

## Round-14 fixes with a scenario

- **#1551 (first-start tab and crumb).** The selected tab and the "You are in" breadcrumb both read
  "Connect a host". Red when the early return in `breadcrumb.ts` is off.
- **#1556 / #1548 (masked token).** A pasted link (`fill`, read as a paste) shows dots in the link field at
  once, and still connects: the host's dot reads online. A link typed key by key shows the dots once the
  field is left. Red when the field's `onChange` keeps the typed text, and `maskOnLeave` returns it
  unmasked (both off at once; each alone is covered by one scenario).
- **#1557 / #1543 (no remote).** On a project with no PR provider, the card says no PR can be opened
  without one, names its branch to push by hand, keeps Review changes as the lead on the Changes tab and
  offers no Open PR. Red when `noRemote` is forced off in `card-run-form.tsx`.

- **#1546 (focus), the part that holds.** After Create card the focus is on the new card's tile. Red when
  the board stops focusing the card it made (`onMade` in `new-card-dialog.tsx`).
- **#1546, Test and add and Add project (issue #1580, fixed in PR #1583).** The focus stayed on the page body
  in a real browser while the unit tests passed in happy-dom. The scenario "The pages the first steps
  open take the focus on their heading" (fd-frontend, in #1583) holds both steps; it ran green on main
  in en and pt-BR. Approve and Open PR are covered by `approval-focus-ui.test.tsx` and are not in this
  feature.

## Not covered

- The project's own trust and setup prompts (#1547) and the long project name in the side bar (#1550):
  layout and copy findings that belong to the UX prints.
- A project whose remote is on GitHub but whose PR host is still `none`: today the card leads with Open
  PR and the refusal comes after the text is typed. That was #1543, fixed by #1557 for the no-provider case; the scenario above covers it.

# BDD: the first hour, from first start to the first PR (issue #1562, for #168 round 14)

## Context

UX round 14 (#168) walked a new person's first hour and filed #1543 to #1551. No journey held that
walk whole: the first-run screen, pairing, the first project, card and PR were each tested apart.

## Decision

`first-hour.feature`, four scenarios (en and pt-BR, 2 to 35 s each on the Pi), all on the page a first
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

## Waiting for their fixes

Added as each merges, per the issue: #1557 (no remote: Open PR says what to do and keeps the text),
#1556 (the pasted pairing link masks its token), #1546 (focus after Test and add, Add project, Create
card, opening a card, Approve and Open PR), #1551 (the first-start tab and crumb).

## Not covered

- The project's own trust and setup prompts (#1547) and the long project name in the side bar (#1550):
  layout and copy findings that belong to the UX prints.
- A project whose remote is on GitHub but whose PR host is still `none`: today the card leads with Open
  PR and the refusal comes after the text is typed. That is #1543 and goes in with #1557.

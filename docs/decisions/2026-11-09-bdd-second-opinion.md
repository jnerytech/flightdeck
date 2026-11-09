# BDD: the second-opinion review before Open PR (issue #1525, for #1439, #1446)

## Context

The second-opinion review (#1439 daemon, #1446 app, canned demo review #1458, drafts link #1514,
focus #1513) had unit and component tests and no journey.

## Decision

`second-opinion.feature`, five scenarios (en and pt-BR, 20 to 55 s each on the Pi), on a project of the
scenario's own with a remote and GitHub as its PR host, no seed change. A card whose description is
`[commit]` and a second line makes the fake Claude commit a two-line file, so the demo's canned review
has two added lines to anchor its high and medium findings on, plus one loose finding.

- **Asking and the wait.** A small tap in the page (the `WebSocket.prototype.send` patch used by the
  while-away and start-elsewhere journeys) holds the `card.review` request until the scenario lets it
  go, so "Reading the diff…" and the disabled button are on screen for as long as the scenario looks.
  Then the canned summary, "2 findings are drafts below", "Not on a changed line (1)" with its body,
  and two reviewer drafts in the changes list.
- **Open PR.** After the review, Open PR's dialog says "2 reviewer findings not addressed (1 high)".
- **Nothing to review.** A card whose run changed nothing has the button off, with the reason.
- **Go to the drafts** puts the focus on the reviewer's first draft (`data-reviewer="draft"`).
- **Focus** is back on "Get a second opinion" once the review ends (the button is off while it runs,
  so the browser drops the focus).

Mutations, each red for the right reason: the review button removed from the panel (all five red);
the focus effect removed, and `goToDrafts` not focusing (the two focus scenarios red).

## Not covered

The host's own refusals (a dropped connection, a diff that moved during the review, a reply in the wrong
form): `second-opinion-ui` and the daemon tests hold them; the demo cannot produce them. Sending the
drafts with Send review is the existing review journey's.

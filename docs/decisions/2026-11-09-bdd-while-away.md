# BDD: the "While you were away" summary (issue #1369)

## Context

After the app was closed for at least 30 minutes, Needs you opens with a summary of what each host
did since the app was last active (#1344): the sessions that finished, the cards that reached In
review, the PRs merged or with failing checks, the failed runs and the quota used, each a link; a
host that did not answer is named. The summary is computed from what the daemon stores, so the demo
hosts need something in each group.

## Decision

- Beta gets two cards in its project that holds the open PR (the seed): one done with its PR merged
  (`DEMO_AWAY_MERGED_CARD`) and one in review whose PR has failing checks (`DEMO_AWAY_FAILING_CARD`).
  The fake `gh` answers the failing PR with a failing check, so the host's poll keeps it that way.
  Alfa already has an ended session, cards in review and the plan quota. A failed run is made by the
  scenario itself, on a project of its own whose workflow fails.
- `while-away.feature`, six scenarios (en and pt-BR):
  - after a long absence the summary says, per host, what each did (alfa: finished sessions, cards
    in review, quota used; beta: a merged PR, a PR with failing checks, cards in review);
  - a line goes to the card it names, and the summary closes;
  - a run that failed while the app was closed is listed under its host, and its line opens the card;
  - Dismiss closes the summary;
  - with nothing new since the app was last active there is no summary: the page's clock moves two
    hours (the hosts keep theirs), so the absence is long and nothing the hosts did is after it;
  - a host that does not answer is named: the page answers beta's `activity.since` with a refusal, in
    place of the host, and every other frame goes through.
- Routing the sockets through Playwright (`routeWebSocket`) left the app without hosts, even with a
  pattern that matched nothing, so the refusal is a patch of `WebSocket.prototype.send` added before
  the page loads.

## Finding for the app slice

A failed run's line is a link only when the app already holds its card (`away.tsx` looks the card up
in the store; the run carries a card id but no project id). Right after a start the card is not
known, so the line is plain text until the card's page or board has been opened in the app. The
scenario opens the card first. Whether the summary should carry the project id is for #1344's owner.

## Not covered

The cap of three lines per group and "and N more" (`while-away-ui` holds them), the 30-minute rule's
edge (`away` unit tests), and quota windows that report no use.

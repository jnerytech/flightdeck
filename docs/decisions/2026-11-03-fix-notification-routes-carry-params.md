# Fix: notification routes carry params (issue #1711, moved from DECISIONS.md)

- The `costs` and `teams` routes take optional params: `costs` has `host`, `projectKey` and
  `client`; `teams` has `host` and `team`. A route without them opens the screen as before.
- Budget alerts: a host budget opens Costs for its host and, for a project budget, its project key
  (a filter); a client budget opens Costs with that client selected. A team alert opens Teams on
  the alert's host with that team listed first and marked `aria-current`.
- The screens seed their state from the params and apply them again when they change while the
  screen is already open, so a second alert on top of the first one still lands. The person can
  change the host or filters afterwards.
- A card's entry (PR watch, unblocked card) stores the card's PR link as `fallbackUrl`. A click
  opens the card route; when the card is no longer in the store, the PR link opens in the browser
  instead. Without a PR link the route is tried as before. The decision lives in `inboxTarget`.

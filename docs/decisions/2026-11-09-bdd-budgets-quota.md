# BDD: budgets as a share of the plan quota window (issue #1309)

## Context

A budget can be a share of the 5-hour or the weekly window of the plan, and the Costs page leads with
the plan quota on a subscription (#1248: #1258, #1276). Nothing drove it in a browser.

## Decision

- `budgets-quota.feature`, four scenarios (en and pt-BR, 3 to 14 s each on the Pi):
  - a host budget of "10%" of the 5-hour window is listed as "10% of the plan", and its meter reads
    100% or more (the demo host reads about 42% of that window);
  - a project budget of "25%" of the weekly window is listed as an estimate; edited into dollars it
    stays one budget, now in US$ and no longer a share of the plan;
  - a project budget of "80%" of the 5-hour window with the action "hold new cards" lists that action;
  - Costs shows the plan quota of the host above the cost charts.
- Own state: a project budget names a project key of the scenario's own, so it measures nothing and
  holds no card of another project. The host budget only notifies. Every scenario removes what it
  made, as its last step.
- It goes red when the unit is not chosen: the "% of the window" field never shows.

## Not covered

The alert and the hold at 100% of a share, and a project's estimated part of the window: the demo has
no usage for a project in the window, so a project's share stays at 0 (`budget-quota` daemon tests and
`orcamentos-quota-ui` hold the thresholds, the hold and the share). A host on an API key, which Costs
leads with dollars for: `costs-quota-lead` holds it.

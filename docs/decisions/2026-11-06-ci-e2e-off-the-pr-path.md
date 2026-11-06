# The e2e journeys leave the PR path (issue #309)

- **Why.** The journeys were the longest PR job left after #312 (e2e 1/3: about 7-10 minutes), and
  the test pyramid puts the expensive tiers on main and nightly.
- **What runs where.** On a PR the screenshots check runs the prints and axe (when the path plan
  says the UI changed) and skips the journeys. On a push to main, the nightly schedule and a
  dispatch the journeys run as before, in their three shards.
- **The required check.** `screenshots (prints, axe e e2e)` keeps its name. On a PR it accepts the
  journeys only as skipped; anywhere else they must succeed, so main and nightly still gate on them,
  and `pr tag` needs main green.

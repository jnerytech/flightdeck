# Phase 36: ROI per project (phase 36)

Proof of concept, run 2026-11-03 on the phase host (git 2.43.0, gh 2.88.1):

1. **Agent commits.** `git log --since="30 days ago" --format=%B | grep -ci "^Co-Authored-By: Claude"` gave 2968 of 2983
   commits (99.5%) in this repository, so the trailer separates agent commits well **here**. It does not prove the
   marker is independent: the trailer is added by the attribution rule the sessions are given, not by Claude Code on its
   own, and a repository with human commits was not available to measure the false-positive side. Decision: the commit
   signal is offered, **off by default**, and labelled approximate on screen.
2. **Approval waits.** Only managed sessions write a request with both `created_at` and `resolved_at`
   (`permission_requests`, `event-store.ts`); the vault keeps `heldMs` on its own decision rows; the hook path of
   terminal and external sessions has no equivalent table. Decision: the "requests waited N h for you" total covers
   **managed-session approvals** and the card says so; the vault wait is not added to it.
3. **Issues closed.** `gh issue list --state closed --search "closed:>=2026-10-01" --limit 100` answered 100 rows in
   0.77 s with a token; without a token (`GH_CONFIG_DIR` empty, no `GH_TOKEN`) it exits at once with "To get started
   with GitHub CLI, please run: gh auth login". Decision: the signal is read **on demand**, cached for an hour, and a
   missing login is the refusal `gh_logged_out`.
- **Planned and unplanned (addendum).** A done card is *planned* when it existed before the period began and *unplanned*
  when it was created inside it. The card's creation time is copied into the done-log row so the split survives a later
  edit, and needs no input from the person.
- **Person (addendum).** A person is a named group of hosts kept in the app; the daemon returns tokens, never a person or
  a limit. The person budget is shown, not enforced, and the table is ordered by name.

**Built in the app (areas `roi-cartao-ui` to `roi-smoke`) and where it stands:**

- **The project's key on `board.get`.** The board view got its project from `board.get`, which did not pass it through
  `forWire`, so the project had no `projectKey`; the card then asked for the path and matched nothing the host had
  summarized under its key. `board.get` now sends the project like `project.list` does (`roi-chave`). The test
  fixture gives the board `projectKeys` only when `roi` is on, as `main.ts` does.
- **Where each input lives.** Default hourly rate, "count my review time" with its cap and the people: Costs, *Return on
  cost settings* (`RoiSettingsPanel`). A client's rate: the Clients screen (`ClientRate`). A project's rate and its
  default hours per card: the card on the board page (*Hours and rate*). One card's hours: the card detail. All money
  stays in the app's storage (`flightdeck.roi`); the daemon never sees it.
- **Plan price and billed amount are not used yet.** `RoiSettings` stores a plan price, but `store.roiMoneyOf` passes
  `planShareUsd: null` and `billed: null`, and the settings screen does not offer them: how to split a monthly plan price
  across projects for a 7-day period is a decision of its own. Nothing on screen claims a plan share.
- **Token units.** A count reads in millions from 100,000 up (`442,857` reads "0.44 million tokens", as the scenario
  says), in thousands from 1,000, plain below.
- **People table loads before it shows.** It says "Reading the hosts…" until the hosts answered; a person whose hosts did
  not answer shows zeros, and the "as of <time>" mark for an offline host is **not** built yet.
- **BDD features.** The 14 scenarios of the spec live in `scripts/e2e/bdd/roi/` (en and pt), outside the glob of
  `bddgen`; `roi-bdd` parses them and checks that every scenario is there, step for step. Two key ones also run as
  journeys, with wording fitted to the demo's data: the headline (`roi-headline`: delivered more than the period before)
  and the people table (`roi-people`), in `bdd/features/` with steps in `steps.ts`. The rest are asserted by the
  `roi-*-ui` tests.
- **`smoke:roi`** finishes two cards on a `--runtime fake` daemon and checks counts, the project default of hours, a
  card's own estimate and the refusal of a malformed range. It does not merge a PR or close an issue.
- **Optional signals (`roi-sinais`).** Two switches per project, both off, stored in `projects.roi_commits` and
  `roi_issues` and sent as `Project.roiSignals`; `project.update` changes them one field at a time. `roi.summary` carries
  `signals` only for the projects that turned them on. Agent commits are counted per commit that has a
  `Co-Authored-By: Claude` trailer in the period (two folders of one project key add up) and the card calls them
  approximate. Issues closed come from the host's `gh` (`issue list --state closed --search closed:<from>..<to>`), kept for
  an hour per folder and period; a missing, signed-out or failing `gh` is `issuesError` (`gh_missing`, `gh_logged_out`,
  `gh_failed`) and is told on the card. Azure Boards is not read.
- **Not done:** the "as of" mark for an offline host, and the items of the acceptance list the maintainer added after
  the first hand-off (executable BDD steps, the demo seed and prints, the spec-verifier run), tracked in the report.

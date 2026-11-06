# A spacing guard on every print, with a baseline that only goes down (issue #588)

- **Problem.** The user found blocks with no gap between them: the project page's configuration
  card sat flush on the link cards above it, and on the earlier days the toasts did the same to
  the status bar (#581) and the search list (#566). fd-ux-designer fixes the pages. What was
  missing is a check that stops a gap from going away again.
- **Rules.** The layout guards (`scripts/lib/layout-guards.ts`, `SPACING`) measure, on every
  `demo:shots` print in both themes and languages:
  - `block-gap`: the direct children of a page body (`data-slot="page-body"`) sit at least 8 px
    apart, whether stacked or side by side;
  - `card-gap`: sibling cards (`data-slot="card"`) sit at least 8 px apart;
  - `card-padding`: text in a card stays at least 8 px from the card's edges, counted from
    inside the element's own padding and border;
  - `text-spill`: text does not run past its own box, when that box neither clips nor scrolls;
  - `chip-gap`: chips (`data-slot="badge"`) in a row sit at least 4 px apart.

  Two boxes that overlap are a finding too. A finding names the element by its data-slot path
  and gives the px it measured, for example
  `block-gap page-body > config (3 px under links, at least 8)`. A name the page holds more than
  once is numbered: a slot in page order, an element with no slot among its siblings
  (`chips > badge[2] (2 px beside badge[1], at least 4)`, `session-tile[1] > span[2]`). Without
  the numbers, two tight pairs under the same names were one finding and one baseline key: fixing
  one left the key, and a new one under the same names did not fail.
- **Ratchet.** The rules are heuristic. The run judges them against
  `apps/desktop/spacing-baseline.json`, whose keys are the rule, `theme lang print` and the path:
  - a finding not in the baseline fails the run;
  - a key in the baseline that is gone also fails the run, with a message to remove it. A fix
    therefore makes the file shorter.

  Without the file, the run fails nothing and only writes the findings down. Each run writes
  what it saw to `apps/desktop/screenshots/spacing-findings.json`, which is in the CI artifact.
  The baseline is built from those files.
- **Not yet.** The baseline holds no px, so a finding already in it that gets worse (7 px to
  0 px) does not fail. Follow-up: #637.
- **Rejected.** Making them contract rules, which fail with no baseline. Today's pages would fail
  every print until all of them are fixed.

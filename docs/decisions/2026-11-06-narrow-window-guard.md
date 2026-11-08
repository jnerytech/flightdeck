# A narrow-window guard on the key pages, with a baseline that only goes down (issue #641)

- **Problem.** At about 1350 px wide, the user saw:
  - tabs that shrink to `w...`;
  - tables that run out of their cards;
  - two scrollbars;
  - clipped titles.

  fd-ux-designer writes the breakpoint spec and fd-frontend builds the shell from it. They need a list of what breaks, page by page and worst first. The list must also stop a fixed page from breaking again.
- **Where.** `demo:shots` resizes the same page after a print's 1280x800 checks: to 1024x700, then 640x800, then 390x844 (`NARROW_SIZES` in `scripts/lib/shots-narrow.ts`). Nothing reloads.
  - Only the dark prints do this. The width does not depend on the theme, and both languages run, because pt-BR strings are longer.
  - Only the prints in `NARROW_SHOTS` do this: hub, inicio-kpis, sessao, host, projeto-blocos, board, configuracoes, card, custos and abas-muitas. These are the pages #641 must bring to zero, plus the ones with tables and tabs.
  - Each narrow print is saved as `screenshots/narrow-<theme>-<lang>/<print>@<WxH>.png`.
- **Rules.** The rules are in `scripts/lib/layout-guards.ts` (`RESPONSIVE`). Each finding names the element by its numbered data-slot path and gives the px it measured.
  - `overflow-x`:
    - the page scrolls sideways (by how many px), with the widest box that can push it: not fixed, and not inside a box that clips or scrolls on x;
    - the outermost box past the right of a parent that neither clips nor scrolls, for example a table past its card. A fixed or absolute box and a `display: contents` wrapper are skipped.
    - text out of the flow (an absolute box with text, such as a disabled button's hanging reason) past the right of the nearest box that clips, scrolls or draws a right border (#1270).
  - `nested-scroll`: a box that hides content and scrolls, inside another that does, or inside the page when the page itself scrolls. The detail gives the px each one hides.
  - `header-clipped`: the page header (`data-slot="page-header"`) starts under the tab row (`role="tablist"`), or the page title (`data-slot="page-title"`) is cut.
  - `sheet-actions` (#1271): in a dialog that fills the window (the sheet below 640 px), a form's buttons (`data-slot="form-actions"`) end above the sheet's bottom (by how many px), or a field the sheet scrolls is still under them at the end of its scroll. A field inside a scroller of its own is not counted.
- **Ratchet.** The baseline is `apps/desktop/responsive-baseline.json`. Each key is the rule, `theme lang WxH print` and the path with no numbers; its value is how many findings share it.
  - More findings than the count fails the prints, naming each one by its numbered path and px.
  - Fewer fails too, until the count is lowered (or the key removed at 0).
  - Without the file, the findings are only written down: the counts to `screenshots/responsive-findings.json`, and each finding by its numbered path to `responsive-findings-occurrences.json`, both in the CI artifact.
  - The first run found 385 findings with numbered keys such as `button[34]`. A button added above would have renumbered every key below it, so the counts key by the path with no numbers.
  - Each entry also keeps the worst `excess` under its key, how many px past the rule's limit (#637): a key whose worst grows by more than 2 px fails too. `nested-scroll` keeps a count only, since what it hides grows with the demo's data.
  - Both baselines come only from the CI artifacts (`*-findings.json`), never from a local run. Fonts and the renderer differ between machines, and the counts are exact both ways (#677). A broken file, or an entry that is not a count, fails the prints with the file's name.

  The spacing baseline (#588) and this one go through the same `ratchetScreen`.
- **Contract rules.** The contract rules (`sideways`, the key regions, the gaps) stay at 1280. At a narrow size, the page scrolling sideways is an `overflow-x` finding with a baseline. As a contract rule, it would fail every page today. Axe also stays at 1280.
- **Visual baselines.** The narrow prints sit under `screenshots/`. When the visual check moves from `record` to `compare`, they get baselines like the other prints.
- **Rejected.**
  - Every print at every size, in all four jobs: about 180 more measurements per job, for pages #641 does not name.
  - A fresh page load per size: resizing the same page is cheaper, and it is what a person does with the window.

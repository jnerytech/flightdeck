# The rc/0362 gate: ui-contraste meets three older tests (issue #1711, moved from DECISIONS.md)

- **Dark lines (`cromo-calmo`).** Phase 10's rule said every line is at most 6% alpha. #98 replaced the dark ones with opaque colors
  on purpose: a 6% line cannot be 3:1 against a surface (WCAG 1.4.11), and the dark theme's panels and dividers had disappeared. The
  rule is now two: the light lines stay faint (6% alpha, #98 did not touch them), and the dark lines are opaque with a floor of 3:1
  and a ceiling of 6:1 against the background, both surfaces and the sidebar. The floor is also in `theme-contrast`; the ceiling is
  what keeps them from being harsh, since a brighter border would still pass the floor.
- **Tokens that point at tokens (`abas-a11y`).** `--card` is `var(--surface-1)` now, so a test that reads a token has to follow the
  reference; its `tokens()` helper resolves `var()` (the check is kept, not dropped).
- **The summary card (`sessao-rolagem`).** #97 made the summary a one-line card, and the first version folded it every time. The
  older rule stays: the card opens the first time a session is seen (it is still a bounded card in the header that pushes the
  conversation down) and is one line after, with the preview. The e2e overlap check holds in both states.

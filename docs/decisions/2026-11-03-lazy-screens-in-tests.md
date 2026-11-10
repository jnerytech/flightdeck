# Lazy screens in tests (issue #1711, moved from DECISIONS.md)

- `lazyScreen` moved to `apps/desktop/src/ui/lazy-screen.ts`. After `preloadAllScreens()` a lazy
  screen renders without suspending; production still loads each chunk when its route opens.
- `apps/desktop/test/dom.ts` (imported by every UI test file) imports `Screens.tsx` and awaits
  `preloadAllScreens()` once per process, so a test that opens Settings, a host page, the board
  and so on can assert in the first pass. This ends the class "asserts before the chunk
  rendered", which no longer depends on the order of the test files.
- Proof: the six files fixed in `flake-hunt` (`app-updater`, `atalho-global-form`,
  `direcao-visual-colunas`, `navegacao`, `paleta`, `terminal-ui-rota`) pass 6/6 alone with their
  `settle` calls removed. The `settle` calls stay: they are harmless and keep each test
  readable about what it waits for.
- `nova-sessao-ux` "a session opened with no persona shows none" (CI timeout at 5 s waiting for
  "Apply"): the persona panel loads over the daemon connection on a slow runner. Both failing
  runs are older than 56112708, which already gives that wait 10 s and the test 15 s; no
  further change.

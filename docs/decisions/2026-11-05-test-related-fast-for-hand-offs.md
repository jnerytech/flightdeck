# `test:related --fast` for hand-offs (issue #219, part of #216)

- **What `--fast` keeps:** the changed test files, the tests that import a changed file
  themselves (one step of the import walk), and the tests that name a changed path as a string
  (`selectByPath`, direct by nature). The changed source files must still be at 100% lines and
  functions, so a gap the direct tests leave is caught on the Pi.
- **What it drops:** the tests that reach a changed file only through another module. They run
  in CI on the pushed branch (#217) and at the coordinator's gate.
- **Measured** on this tree (tests selected for one changed file, transitive then direct):
  `packages/protocol/src/index.ts` 688 and 141, `apps/daemon/src/server.ts` 417 and 121,
  `apps/desktop/src/i18n/en.ts` 359 and 19, `apps/desktop/src/lib/app-store.ts` 345 and 274. A
  direct set over 60 files still goes through the slot.
- **The hand-off default** in CLAUDE.md, TDD.md and `tdd-area` is now `bun run test:related --
  --fast`; the transitive run stays available without the flag.

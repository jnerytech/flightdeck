# The e2e journeys of each language are a file of their own (issue #292)

- **Why.** Measured on CI (2026-11-05): e2e shard 1/3 took 7 to 11 minutes while 2/3 and 3/3 took
  15 seconds to 1.5 minutes. Playwright keeps the tests of one file together on a shard, and
  `journeys.e2e.ts` held both languages, so all 32 journey tests landed on shard 1 (`playwright
  test --list --shard=2/3` listed 0 tests). Only the BDD scenarios were left for the others.
- **Split by language.** `scripts/e2e/define-journeys.ts` defines the journeys of one language;
  `journeys-pt-BR.e2e.ts` and `journeys-en.e2e.ts` call it. The shards now list 16, 16 and 12
  tests (one language each, then the BDD scenarios). Each CI shard starts its own demo, so each
  language has its own seed. The "second language relies on the first" in the old notes was a
  tolerance, not a need: the issue journey waits for either the Criar card button or the made card,
  and the acoes journey trusts an action of its own per language. A local `bun run e2e` still runs
  both on one demo, now in file order (en, then pt-BR).
- **Left for later.** The Windows unit-test shards (9 to 12 minutes against 5 to 8) are split by
  `bun test --shard`, which balances by file count; balancing them by recorded durations needs its
  own timing file and script, and stays open in #292.

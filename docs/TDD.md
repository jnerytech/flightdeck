# Flightdeck — Disciplina TDD e regras de teste (Fase 2 em diante)

Vale para todas as fases a partir da 2. Cada spec de fase define as suas áreas de teste e a tag
de partida da auditoria; o resto está aqui. Foi escrito a partir do que deu errado na primeira
tentativa da Fase 2 (branch `fase-2-tentativa-1`).

## Ciclo de cada área

1. **Um arquivo de teste por área**, com o nome da área: `apps/<app>/test/<área>.test.ts(x)` ou
   `scripts/test/<área>.test.ts`. "O teste da área" é sempre esse arquivo.
2. **Stub antes do vermelho.** Crie o módulo com as assinaturas reais devolvendo valores errados
   (`""`, `[]`, `false`, `null`). Nunca `throw`: exceção é erro, não asserção. O stub fica fora
   do commit de teste.
3. **Rode só o arquivo:** `bun --config=bunfig.area.toml test <arquivo>`. O `bunfig.area.toml` é o
   mesmo bunfig sem o limite global de cobertura; `bun test <arquivo>` puro sai com 1 mesmo com
   tudo passando, porque um arquivo sozinho não cobre 100% dos módulos que toca.
4. **O vermelho precisa ser de asserção** (`expect(...)`), não de import, sintaxe, tipo, timeout
   de helper ou elemento ausente. Se a rodada falhar por erro, ajuste o teste e rode de novo. A
   evidência que conta é a rodada vermelha por asserção imediatamente antes do commit de teste.
   Mostre todas as rodadas; não esconda as que falharam por erro.
   - UI: `queryBy*` + `expect(...).not.toBeNull()`, nunca `getBy*` (que lança).
   - Waits (desktop tests): `settle` from `apps/desktop/test/wait.ts` THROWS `WaitTimeout` when time
    runs out, naming what it waited for (the check's own source, or a label): a wait that returns
    silently makes a later assertion fail far from the cause. This is the one allowed exception
    to "red by assertion", since the wait is itself the assertion. A wait whose answer may be
    "never" uses `settleMaybe` (it returns a boolean). A wait that returns a value stays `poll`
    followed by an `expect`. Never define a `settle`, `waitFor` or `until` of your own in a test
    file: `wait-baseline.json` (a ratchet, like the layout one) only goes down.
    Never wait a guessed time: after an action use `settle` on what the test reads next, `stays` for
    a thing that must NOT happen (it watches the whole window), or `uiIdle` for a helper's trailing
    wait (the screen stopped changing). `lazy-wait-baseline.json` (a fixed wait before a one-shot
    query, or ending a helper) is empty, and an `act(() => Bun.sleep(…))` is allowed only with a
    `// timing:` comment on the line above saying why the clock is the thing under test.
   - Nada de `toMatchSnapshot` na primeira rodada: ele grava o resultado do stub. Use literais
     escritos à mão (`toBe`, `toMatchInlineSnapshot` com o texto).
   - `toContain` sobre algo que pode ser `undefined`: use `?? ""`.
5. **Commit só do teste**, com caminhos explícitos (`git add <arquivo>`, nunca `git add -A`), e
   confira `git status --short` antes: `test(<área>): <comportamento>`.
6. **Implementação mínima**, mesmo comando verde, depois a suíte inteira
   (`bun run slot -- bun run test`, que inclui o limite de 100% e o verificador de arquivos-fonte),
   ou `bun run test:related -- --fast` numa sessão (a suíte inteira roda no CI), `bun run typecheck` e
   `bun run lint`, encadeados (`&&` ou `set -o pipefail`) para o commit não acontecer depois de
   uma falha. Commit `feat(<área>): ...`.
7. **Cobertura revela ramo sem teste?** Remova o ramo, escreva o teste, mostre o vermelho e só
   então restaure. Nunca teste depois.
8. **Erro no próprio teste** (expectativa errada, tipo errado): corrija num commit
   `test(<área>)` antes do `feat`, sem enfraquecer a asserção.
9. **Escopos:** todo `feat(x)`/`fix(x)` precisa de um `test(x)` anterior com o mesmo escopo, um
   escopo por commit. Limpeza de lint ou formatação é `refactor(x)` ou `chore`, nunca `fix`.
   Comportamento novo fora da tabela da fase ganha o próprio escopo e o próprio ciclo.
10. **Smokes começam vermelhos:** o script é escrito, roda falhando no passo certo (saída
    controlada com código 1, não crash) e é commitado num `test(<área>)`.
11. **Proibido:** implementação antes do teste, enfraquecer ou apagar asserção para passar,
    `.only`, `.skip` ou `test.todo` em código commitado.

A auditoria `bun run tdd:audit -- --since <tag>` confere a ordem dos commits e a ausência de
testes desligados. With `--spec docs/SPEC-fase-N.md` it also fails on an area of the spec's table
with no `test(<area>)` commit. From phase 40 on the spec follows `docs/templates/SPEC.md`, and
`bun run spec:lint <spec>` (run by the suite for every such spec) checks its sections and table.

**Checked at commit time and in CI.** Without `--since` (or with `--since auto`) the audit starts
at the merge-base with `main`, or at the last tag when `HEAD` is on `main`; CI runs it that way on
every push and pull request. The project's PreToolUse hook (`.claude/hooks/guard.ts`, rules in
`scripts/lib/claude-hooks.ts`) checks the same things earlier:

- it refuses a `git commit` whose subject is not `type(scope): text`, a `feat`/`fix` without a
  scope, and a `feat(x)`/`fix(x)` with no `test(x)` commit since that base;
- it refuses an Edit or Write that adds `.only(`, `.skip(`, `test.todo(` or `toMatchSnapshot(` to
  a test file (one that keeps or removes them passes).

For a deliberate exception, end the commit message with a trailer line `TDD-Waiver: <why>` (or
pass `--trailer "TDD-Waiver: <why>"`). The hook lets the commit through and `tdd:audit` lists it
as waived; the trailer needs no hash, so it survives a rebase. `scripts/tdd-audit-waivers.json`
keeps the waivers made before trailers existed. A message the hook cannot read (from an editor or
a file) passes, and so does a commit hidden in `sh -c` or a subshell: the hook is a guardrail, and
the audit in CI is the wall. `bun run harness:stats` shows how often each rule blocked and how
many commits were waived.

**Antes de entregar uma sessão:** `bun run typecheck`, `bun run lint`, `bun run tdd:audit` e
`bun run test:related -- --fast`. O `test:related [--base <ref>]` roda só os testes que alcançam o
que mudou desde o merge-base com `main` (os arquivos de teste alterados e os que importam, direta ou
indiretamente, um arquivo alterado), e imprime cada um com o motivo. **`--fast`** (the hand-off
default, #219) keeps only the tests that import a changed file directly, plus the changed tests
and the tests that name a changed path, and still demands 100% coverage of the changed source
files. On a hub file the set shrinks a lot (`packages/protocol/src/index.ts`: 688 tests
transitively, 141 directly; `apps/desktop/src/i18n/en.ts`: 359 and 19). The transitive set runs
in CI on the pushed branch. A suíte completa
(`bun run slot -- bun run test`, com o limiar de 100%) roda na barreira de versão do orquestrador
e no CI.

**Which function is not covered.** Bun's coverage (the full suite) counts functions per file but
does not name them, so a file at 94% function coverage does not say which function is missing.
`bun run coverage:funcs <file.ts>... [--tests <test.ts>...]` does: it runs the tests that reach the
files (the same selection as `test:related`; `--tests` names them by hand, which a hub file that
hundreds of tests reach needs) and prints, per file, `N of M functions never called` followed by
`file:line  name` for each one (methods and arrows have no name in istanbul's map, so they show their
source line). The files are instrumented in memory by `istanbul-lib-instrument`, through a
`Bun.plugin` in a preload that only this command passes: the sources on disk are never written, and
only the files listed are instrumented. Limits: it follows the test process only (a function that
runs in a spawned child counts as not called), and istanbul skips private `#methods`. Use it before
hand-off on the files you changed, to close a function gap without bisecting.

**Functional core, imperative shell.** Logic that decides is a function that takes its effects
(git, fs, clock, spawn, network) as a deps object or an injected context, as `runAudit({ since,
git, readFile })` and the daemon's service contexts do; the entry file or the command handler
only wires the real ones. The tests then pass fakes instead of `mock.module`, which leaks across
files. This is a rule, not a style rewrite: React components and Bun idioms stay as they are.

## Travas

Os testes provam o comportamento sem tocar em nada real. As travas tornam isso verificável,
em vez de depender de cuidado.

- **Claude real.** `scripts/test/preload.ts` (preload dos dois bunfigs) põe um `claude`
  sentinela no início do PATH, tira do PATH as pastas com um `claude` de verdade e reprova a
  suíte se o sentinela tiver sido executado. Também aborta se a busca no PATH atual não cair
  no sentinela.
  - Código que procura executáveis usa `whichOnPath` (`apps/daemon/src/which.ts`).
    `Bun.which(nome)` sem opções usa o PATH de quando o processo começou e escapa da trava.
  - Teste que sobe o daemon com runtime `claude` aponta `claude.executablePath` para um
    caminho inexistente.
  - Todo smoke, exceto o `smoke:real`, instala a mesma trava e confere antes de imprimir o OK.
- **Home real.** O preload aponta `HOME` e `USERPROFILE` para uma pasta temporária, e a
  resolução de `~` lê a variável de ambiente atual. Processos filhos (daemon dos smokes,
  CLIs falsos) recebem esse ambiente explicitamente, nunca o da partida do processo. Nada
  lê nem grava o `~/.claude` real.
- **A temp folder per run.** Before anything else, the preload points `TEMP`, `TMP` and `TMPDIR`
  at a fresh `fd-run-*` folder inside the temp folder it found (`scripts/test/temp-run.ts`), so
  every folder a test, a guard or a child process makes lands there, and removes it at the end,
  even when a test or a guard fails. A file still held open on Windows can keep it: the run's pid
  is written in it, and the next run sweeps the `fd-run-*` folders whose process is gone. Before
  this, the suite left everything in TEMP, and a child bun started under a TEMP of hundreds of
  thousands of entries took about 150 ms more to start.
- **Outros executáveis falsos** (`gh`, `az`, comandos de `check`): entram no PATH de teste e
  são resolvidos com `whichOnPath`. No Windows, precisam de versão `.cmd`.
- **Serviços e sistema.** Instalação de serviço, `systemctl`, `schtasks` e afins passam por um
  contexto injetado; os testes nunca os executam. Config de teste sempre em pasta temporária.

- **The slot for the heavy runs.** The full suite, `demo:shots`, `e2e`, the smokes and the builds
  run through `bun run slot -- <command>` (an exclusive lock with a queue, `scripts/lib/slot.ts`),
  never bare: two heavy runs at once overload the machine and make the timing-sensitive tests
  flaky. Area tests, typecheck and lint do not need the slot; `bun run typecheck` and
  `bun run lint` take a place in the light lane instead (`scripts/lane.ts`, two places), because
  one tsc run takes up to 1.5 GB and six at once ran the machine out of memory. A full gate that must not be
  disturbed by the sessions' area tests runs with `--priority` (`bun run slot -- --priority bun run
  test`): while it runs, the slot raises the niceness of the other bun test processes of the
  same user to 15 every few seconds. It only raises (never lowers a niceness), skips its own
  process tree, restores nothing (those processes finish niced) and does nothing on Windows.
- **No floating promises.** Biome's `noFloatingPromises` (nursery, type-aware) is an error for
  `apps/` and `scripts/`: TypeScript does not flag a call whose promise nobody awaits, and in a
  test that call races the next line (an assertion runs before the work, a cleanup before the
  stop). Await the call. When the test means to leave it alone, say so with `void`
  (`void server.stop()` cuts a connection without waiting for it to drain). Do not silence the
  rule with a `biome-ignore`.

- **BDD for the journeys a person reads.** The journeys a non-programmer reads (approval, new
  session, board, the simple mode of phase 33) are Gherkin scenarios in `pt-BR` and `en`
  (`scripts/e2e/bdd/features/`, run by `playwright-bdd`, pinned exactly), written to create their
  own state. Layout, terminal and keyboard journeys stay plain TypeScript
  (`scripts/e2e/journeys.ts`), and unit tests stay plain bun tests with behavior titles. The
  pilot's measurements are in `docs/DECISIONS.md` ("BDD pilot").

## Armadilhas conhecidas

- O bun test esconde as linhas `(pass)` quando `CLAUDECODE` está definida: para mostrar a lista,
  rode `env -u CLAUDECODE bun --config=bunfig.area.toml test <arquivo>`.
- Testes de UI: o happy-dom é registrado uma vez por processo (`registerDom`), React e Testing
  Library são importados com `import()` depois disso, e `liveScreen` consulta o documento atual.
- Biome: no modo stdin, o código de saída não reflete diagnósticos. Para testar uma regra, grave
  um arquivo real e apague depois. Padrões de import precisam de `**` (`@tauri-apps/**`).
- `cargo check` exige `apps/desktop/dist`: rode `bun run slot -- bun run build:desktop` antes. Plugins do Tauri
  ficam no major 2.
- No Git Bash, `schtasks /TN ...` tem o `/TN` reescrito como caminho; use PowerShell.
- UI tests that wait on a daemon: inside `waitFor`, never `expect(element).toBeNull()` or
  `.not.toBeNull()` on a DOM element. A failed `expect` formats the happy-dom tree, which takes
  seconds and blocks the event loop on every retry, so the socket's answer never arrives and the
  test times out. Use a boolean (`expect(button(name) !== null).toBe(true)`). A button with
  `aria-hidden` has an empty accessible name: find it with `getByLabelText`.
- A file that `mock.module`s a project module must capture the real module first
  (`const real = { ...(await import(path)) }`) and restore it in `afterAll`
  (`mock.module(path, () => real)`), because Bun module mocks outlive their file and later files
  in the same run would draw the stand-in.

## Delivery (GitHub Flow, #260)

- Every branch reaches `main` through its own PR: `bun run pr -- open <branch>` titles it after the
  branch's issue and closes it. A branch stacked on another opens with `--base <parent>`.
- CI runs once per commit: on the PR (`pull_request`), on `main` (`push`), or by hand for a branch
  with no PR yet (`bun run ci:branch`).
- `bun run pr -- next` lists the open PRs in merge order with what each still needs.
  `bun run pr -- update <n>` brings one up to date with its base. `bun run pr -- merge <n>` (the
  coordinator) merges with a merge commit, never a squash, and only when the main ruleset's
  required checks are green on the PR's HEAD and it is up to date.
- A release is a tag on a green `main`; there is no rc branch to assemble. `bun run pr -- tag vX`
  (the coordinator) tags main's HEAD only after its full CI run on main passed, and pushes the tag
  alone as `refs/tags/vX`.

## Evidência para o /goal

- Cada comando de critério mostra o próprio código de saída (`echo $?` logo depois, ou
  `${PIPESTATUS[0]}` quando há pipe). Checagens de estado do sistema vão em chamadas separadas,
  para não misturar códigos de saída.
- "Nenhum teste usou o Claude real" se prova pela trava: as rodadas finais do bun test e dos
  smokes passam com ela ativa.

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
   - Nada de `toMatchSnapshot` na primeira rodada: ele grava o resultado do stub. Use literais
     escritos à mão (`toBe`, `toMatchInlineSnapshot` com o texto).
   - `toContain` sobre algo que pode ser `undefined`: use `?? ""`.
5. **Commit só do teste**, com caminhos explícitos (`git add <arquivo>`, nunca `git add -A`), e
   confira `git status --short` antes: `test(<área>): <comportamento>`.
6. **Implementação mínima**, mesmo comando verde, depois a suíte inteira (`bun run test`, que
   inclui o limite de 100% e o verificador de arquivos-fonte), `bun run typecheck` e
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
testes desligados.

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
- **Outros executáveis falsos** (`gh`, `az`, comandos de `check`): entram no PATH de teste e
  são resolvidos com `whichOnPath`. No Windows, precisam de versão `.cmd`.
- **Serviços e sistema.** Instalação de serviço, `systemctl`, `schtasks` e afins passam por um
  contexto injetado; os testes nunca os executam. Config de teste sempre em pasta temporária.

- **The slot for the heavy runs.** The full suite, `demo:shots`, `e2e`, the smokes and the builds
  run through `bun run slot -- <command>` (an exclusive lock with a queue, `scripts/lib/slot.ts`),
  never bare: two heavy runs at once overload the machine and make the timing-sensitive tests
  flaky. Area tests, typecheck and lint do not need the slot.

## Armadilhas conhecidas

- `bun test` esconde as linhas `(pass)` quando `CLAUDECODE` está definida: para mostrar a lista,
  rode `env -u CLAUDECODE bun test`.
- Testes de UI: o happy-dom é registrado uma vez por processo (`registerDom`), React e Testing
  Library são importados com `import()` depois disso, e `liveScreen` consulta o documento atual.
- Biome: no modo stdin, o código de saída não reflete diagnósticos. Para testar uma regra, grave
  um arquivo real e apague depois. Padrões de import precisam de `**` (`@tauri-apps/**`).
- `cargo check` exige `apps/desktop/dist`: rode `bun run build:desktop` antes. Plugins do Tauri
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

## Evidência para o /goal

- Cada comando de critério mostra o próprio código de saída (`echo $?` logo depois, ou
  `${PIPESTATUS[0]}` quando há pipe). Checagens de estado do sistema vão em chamadas separadas,
  para não misturar códigos de saída.
- "Nenhum teste usou o Claude real" se prova pela trava: as rodadas finais de `bun test` e dos
  smokes passam com ela ativa.

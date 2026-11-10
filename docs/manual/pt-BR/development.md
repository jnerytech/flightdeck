# Desenvolvimento

[Voltar ao manual](../pt-BR.md) · [English](../en/development.md)

```sh
bun run typecheck      # tsc em todos os workspaces e scripts
bun run lint           # Biome
bun run test:related   # os testes do que você mudou, 80% de cobertura nos arquivos mudados
bun run test           # a suíte inteira, 80% de linhas e funções por arquivo (#1002)
bun run smoke          # ponta a ponta com o daemon real e --runtime fake; imprime SMOKE OK
bun run smoke:multi    # dois daemons, um cliente, permissão via session.summary; SMOKE MULTI OK
bun run smoke:history  # indexa, busca, retoma e vê history.changed; SMOKE HISTORY OK
bun run smoke:board    # card com gh falso e remoto local até o PR mesclado; SMOKE BOARD OK
bun run smoke:central  # hooks, flightdeckd claude com o claude falso, aprovação e canal; SMOKE CENTRAL OK
bun run smoke:workflow # o workflow de exemplo inteiro, check e gh falsos, até o PR mesclado; SMOKE WORKFLOW OK
bun run smoke:limits   # cota e fila por cota, regra do projeto, recusa de bypass e hook com updatedPermissions; SMOKE LIMITS OK
bun run smoke:ops      # operação do host: manutenção (backup, limpeza), protocolo incompatível, restore
bun run smoke:update   # servidor de release local, daemon-latest.json, binários assinados e a recusa de um adulterado
bun run smoke:costs    # custos a partir de transcripts de fixture, orçamento que segura um card, exportação CSV
bun run tdd:audit -- --since fase-5   # todo feat/fix tem um commit test do mesmo escopo antes
bun run build:daemon   # binários em dist/
bun run build:desktop  # frontend Vite em apps/desktop/dist
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml   # requer apps/desktop/dist
```

Desde a Fase 2 o desenvolvimento é em TDD ([`docs/TDD.md`](../../TDD.md)): o teste de cada área
nasce vermelho, roda sozinho com `bun --config=bunfig.area.toml test ./<arquivo>` (mesmo bunfig,
sem o limite global de cobertura) e é commitado como `test(<área>)` antes do `feat(<área>)`. O
preload dos dois bunfigs instala uma trava que reprova a suíte se algum teste executar o `claude`
de verdade, e outra que aponta `HOME`/`USERPROFILE` para uma pasta temporária, para nenhum teste
ler o `~/.claude` real. A trava de check (Fase 6) só deixa um `check` de workflow chegar ao
shell se o comando for um falso instalado pelo próprio teste. Os smokes (menos o `smoke:real`)
usam as mesmas travas. Os fixtures de transcript ficam em `apps/daemon/test/fixtures/history/` e
são escritos à mão.

Testes e smoke usam só o `FakeRuntime`. `bun run smoke:real` repete o roteiro com o Claude de
verdade numa pasta descartável. Ele é manual, gasta cota e não faz parte dos critérios de aceite.

Outros scripts do `package.json`: `bun run coverage`, `bun run format` (Biome com `--write`),
`bun run ui:lock` (grava `apps/desktop/components.lock.json`, o hash de cada componente shadcn/ui
gerado pelo CLI), `bun run release:version`, `bun run release:assets`,
`bun run release:tauri-config` e `bun run release:sign` (os quatro últimos são usados pela
[release](releases.md#releases)).

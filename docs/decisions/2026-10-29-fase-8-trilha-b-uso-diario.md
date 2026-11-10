# Decisões e divergências da Fase 8, trilha B (uso diário) (phase 8)

## Protocolo (só adições)

- **`summary` nas listas:** `session.list`, `history.list`, `external.list` e os frames `external.updated` levam um `SessionLine` com `request`, `state` (`running`, `waiting`, `idle` ou `ended`), `tool` e `since`.
  - O daemon manda dados, não texto. O app monta "Pedido: … · rodando Bash" e calcula o "ociosa há N min" com o relógio dele (injetável), de modo que a linha não envelhece entre duas listas.
  - O pedido e a última ferramenta vêm das linhas já indexadas (`history_messages`), na ordem do arquivo. Não há tabela nem migração.
  - O estado vem do que o daemon sabe ao vivo: o status da sessão gerenciada ou externa, e a ferramenta do pedido aberto. Uma sessão do histórico é sempre `ended`.
  - O corte de 80 caracteres conta o "…": 79 caracteres e a reticência.
  - No app, a linha de uma sessão gerenciada usa o estado, a ferramenta pedida e o `since` do `session.summary` ao vivo. A lista só é recarregada quando sessões entram ou saem, e sem isso a linha discordaria do selo da própria linha. O pedido continua vindo da lista.
  - Uma sessão do terminal recebe outro `external.updated` quando um pedido dela abre ou fecha, porque o frame do hook chega antes de o pedido existir e diria "esperando aprovação" sem a ferramenta.
- **`PendingPermission.input`:** opcional, com o mesmo corte de 200 caracteres das sessões do terminal (`summarizeInput`). É o que permite o "ferramenta: resumo" da bandeja para as sessões gerenciadas.
- **`host.info`:** ganhou `flightdeckdPath` (o binário estável da Fase 7 quando existe, pela home do ambiente) e `wslDistro` (`WSL_DISTRO_NAME`). Não é feature: um daemon antigo não manda nada, e o app usa `flightdeckd` do PATH.

## Bandeja

- **Modelo no app, desenho no Rust:** `lib/tray.ts` monta as entradas (rótulo, chave `hostId/requestId` e ações). A casca só refaz o submenu (`tray_set_menu`) e emite `tray-action` com a chave e a ação de cada clique.
- **Ids dos itens:** `act:<ação>:<chave>`, e "e mais N…" é `act:open:more`. A chave pode ter `:` (gates), por isso só o primeiro `:` depois da ação separa.
- **Debounce de 500 ms:** só o submenu. O número e a dica do ícone continuam imediatos. Cada mudança reinicia a espera, e uma lista igual à já enviada cancela o envio. Os timers são injetados (`AppStoreOptions.timers`).
- **Resumo da entrada:** o mesmo da conversa (`lib/tool-input.ts`, que antes ficava no `ToolCall`): `file_path`, `command`, `pattern`, `path`, `url` ou `description`, senão o JSON, cortado em 80.
- **Pedido já respondido:** clicar nele na bandeja (ou no link) não faz nada além de trazer o app, porque o menu pode estar até 500 ms atrás.
- **No Windows,** `&` no rótulo vira `&&`, para que um comando como `a && b` não vire atalho de menu.
- **Clique na notificação (divergência):** o `tauri-plugin-notification` não informa cliques no desktop. O link `flightdeck://request?host=…&request=…` vai na notificação, é seguido pela versão web (o `onclick` da notificação do navegador) e funciona aberto por fora (deep link e instância única). No app desktop, a ação rápida fica na bandeja, como a spec já previa para os botões.

## Abrir no terminal

- **Quem decide o comando:** `lib/terminal.ts`, uma função pura testada nos dois sistemas. O Rust só confere o programa (lista branca: `wt.exe` e `cmd.exe`) e roda `Command::new(programa).args(lista)`.
- **"Host local":** o endereço é `127.0.0.1`, `localhost` ou `[::1]`, e o app roda no Windows.
  - Com `os` `win32`, é este Windows.
  - Com `os` `linux` e `wslDistro`, é a distro supervisionada (o WSL2 encaminha o localhost).
  - Um Linux local sem distro, por exemplo um túnel SSH, recebe o comando para copiar.
- **WSL sem Windows Terminal:** vai pelo mesmo `cmd.exe /c start ""`, que a spec não detalhava.
- **`cmd /k`:** o `cmd.exe` de fora sai com `CREATE_NO_WINDOW`, porque o `start` já abre o console do terminal. As aspas de um caminho com espaço ficam com o Rust, e o `cmd /c` não as remove porque o primeiro caractere é o `s` de `start`.
- **`wt.exe`:** é um alias de execução do Windows (ponto de reparse), então a busca no PATH usa `symlink_metadata`.
- **Copiar comando:** usa aspas POSIX (`'…'`) só quando a palavra precisa delas; num host Windows remoto, `cd /d "…"`. O `<flightdeckd>` segue a mesma regra do terminal local (estável, senão do PATH).
- **Sessão gerenciada ainda sem `session.init`:** o botão só aparece quando o Claude Code já deu o id da sessão, porque antes disso não há o que retomar. O card sem sessão abre a worktree com um `claude` novo.
- **App web:** `terminal.supported` é falso, então o botão vira "Copiar comando".
- **Trava:** os testes injetam o executor (`platform.terminal`). O preload põe uma sentinela em `__TAURI_INTERNALS__`, que é por onde o `invoke` do `@tauri-apps/api` chega à casca. Com o DOM dos testes de UI, `window` é o objeto global. Qualquer chamada que chegue lá é gravada e reprovada no `afterAll`. Um teste mostra a sentinela funcionando num escopo próprio.
  - Nenhum `mock.module` foi usado para isso, porque ele vaza entre arquivos do mesmo processo.
  - O adaptador Tauri recebe `invoke` e `listen` por parâmetro nos testes.

## Paleta

- **Seções:** Sessões ao vivo (gerenciadas não encerradas e do terminal vivas), Cards, Projetos, Hosts e Ações, filtradas pelo rótulo. O Histórico vem depois, com a busca da Fase 3.
- **Enter:** com uma entrada escolhida, abre. Sem nada escolhido, é o submit do formulário, que é a busca de histórico, como antes. Assim a busca global da Fase 3 ficou igual, e os testes dela não mudaram.
- **Tab:** mostra as ações da entrada como uma seção "Ações de …". Tab de novo ou Esc volta, e Esc fecha a paleta só fora das ações.
- **O que a paleta carrega:** ao abrir, carrega em silêncio as listas de Sessões, `project.list` e `board.get` de cada projeto. Um host sem board não gera banner.
- **Card:** a paleta só abre o card. O terminal dele fica na tela do card, ao lado da worktree.
- **"Ir para Custos":** a trilha B não tem a tela. A paleta recebe `costs`, que o App passa como `false`, e mostra a ação só com isso e com um host que anuncia `costs`. A trilha A liga o destino (`PaletteTarget` `costs`) ao rebasear.

## TDD e testes

- **Escopos:** só os quatro da tabela. As partes do daemon, do protocolo e do Rust entraram na área que as usa.
- **Correções de teste** (`test(...)` antes do `feat`, cada uma com a rodada vermelha):
  - em `resumo-lista`: o pedido do terminal só é segurado com um app observando, e a expectativa exata de `protocolo-historico` ganhou o `summary`;
  - em `bandeja-aprovacao`: o tipo das ações esperadas;
  - em `paleta`: os helpers olham só dentro da paleta, a sessão do terminal entrou na lista e o board espera o nome do projeto.
- **Ramos revelados pela cobertura** seguiram a regra 7: o banner do executor que falha, a sondagem da plataforma web, o link de pedido já respondido e o clique numa entrada da paleta.
- **Pastas temporárias:** pelo `realTempDir` da área "plataforma", sobre a qual a trilha foi rebaseada no meio do trabalho (antes de abrir-terminal). A home do binário estável vem de `userHome(env)`.

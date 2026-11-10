# Decisões e divergências da Fase 7, trilha B (limites e regras) (phase 7)

O que a spec da Fase 7 deixou aberto para a trilha B, ou o que mudou na implementação.

## Cota

- **Evento interno:** o `rate_limit_event` vira um evento `quota` do runtime, que o session manager entrega à `Quota` do host (`onQuota`). Ele nunca vira `SessionEvent`: não é gravado, não é reenviado e o app não o recebe numa assinatura de sessão.
- **Leitura defensiva:**
  - O daemon lê `rate_limit_info.unifiedWindows` quando existe; sem ele, a janela do topo (`rateLimitType`, `utilization`, `resetsAt`).
  - Uma janela com `status` desconhecido (fora de `allowed`, `allowed_warning` e `rejected`) é ignorada.
  - `utilization` fica como fração; ausente, vira `null`. `resetsAt` chega em segundos e é guardado em milissegundos; ausente, a leitura vale até a próxima.
- **Onde fica:** a leitura vive só em memória, no daemon, e volta com o próximo turno depois de um reinício.
  - A única migração da trilha é a `usage_daily`.
  - `quota.get` e `quota.watch` não têm histórico.
- **Vencimento:** um timer injetável (relógio e agendador) é armado para o próximo `resetsAt`. Quando dispara, remove a janela e avisa quem faz `quota.watch`. Uma leitura que já chega vencida é descartada.
  - O atraso do timer é limitado a 2³¹ − 1 ms (cerca de 24,8 dias). Acima disso o timer dispararia na hora, num laço; ao disparar antes, ele é armado de novo.
  - A leitura também é filtrada pelo relógio ao ser lida, então um timer atrasado (host que dormiu) nunca mostra nem bloqueia por uma janela vencida.
- **O app:** pede `quota.get` ao conectar, além do `quota.watch`, porque o `quota.watch` não manda o estado atual.

## Fila por cota

- **O que bloqueia:** uma janela válida com `utilization ≥ pauseAt` ou `status: rejected`. Com `pauseAt: null`, nada bloqueia, nem o `rejected`.
- **`until`:** é o maior `resetsAt` das janelas que bloqueiam; se alguma não tem `resetsAt`, fica `null`.
- **Card:**
  - Ganhou `queueReason` (`slot` ou `quota`) e `quotaUntil`, ambos com `null` como padrão no schema.
  - O motivo é calculado na leitura do card, e cada mudança de cota manda um `card.updated` para os cards na fila.
- **Fila:** a cota só segura a escolha de novos cards. Execuções em andamento e a volta de um gate aprovado seguem, porque esperam a cota no próximo turno.
- **Workflow:**
  - Antes de cada turno de agente (logo depois do orçamento), se a cota bloqueia, a execução continua `running` com `statusReason: "aguardando cota"`, e a execução expõe `quotaUntil` (só em memória).
  - Se o card for concluído ou descartado durante a espera, a execução para ali, sem seguir.
  - A linha do tempo do card mostra "aguardando cota até HH:MM".
- **HH:MM:** o daemon manda o instante em ISO, e o app formata com uma função injetável (o fuso da máquina quando ausente).

## Uso

- **Custo do turno:** o session manager chama o `UsageLedger` antes de gravar cada `turn.result`. O custo do turno é `max(0, total − total anterior)`, e o total anterior vem do último `turn.result` gravado daquela sessão nos `events`. Isso vale através de reinícios e de `resume`, sem tabela extra.
- **Tokens:** `input_tokens` e `output_tokens` do `turn.result` são tratados como do turno. Os tipos do SDK não dizem se são cumulativos.
- **Dia e projeto:**
  - O dia é `AAAA-MM-DD` por uma função injetada (`localDay` usa o fuso da máquina).
  - O projeto é a `projectKey` da Fase 5, por um `ProjectKeys` próprio do daemon.
- **`usage.summary`:** devolve as linhas dos últimos `days` dias, de 1 a 90 (padrão 7). A ordem é do dia mais novo para o mais antigo e, dentro do dia, por projeto.

## "Permitir sempre"

- **Validação compartilhada:** um único validador (`permission-updates.ts`) serve às sessões gerenciadas e às do terminal.
  - Recusa destinos fora de `session` e `localSettings`.
  - Recusa `setMode` para `bypassPermissions` ou `auto`.
  - Aceita só sugestões do próprio pedido, com igualdade campo a campo e as chaves em qualquer ordem, ou uma regra do projeto (`addRules`, `allow`, `localSettings`).
  - Numa regra do projeto, cada regra precisa ser da ferramenta do pedido, e o `ruleContent`, quando existe, não pode ser vazio, ter quebra de linha nem passar de 500 caracteres.
- **Sugestões:** as que o daemon não entende são descartadas uma a uma, para que um tipo novo do SDK não derrube o pedido.
- **Item recusado:** um item ruim recusa a resposta inteira, nada é aplicado e o pedido continua aberto.
- **FakeRuntime:**
  - `[tool]` (Write) sugere `addDirectories` e `setMode acceptEdits` de sessão.
  - `[bash]` (Bash `npm test --silent`) sugere a regra `npm test:*` em `localSettings` e o comando exato em `session`.
  - O `tool.result` repete os `updatedPermissions` recebidos, e é assim que o smoke vê a regra chegar ao runtime.

## Regras do projeto

- **Qual sessão é de card:** a de uma execução do card (`card_runs`) ou de uma etapa de workflow (`step_runs`). Regras aceitas em outras sessões não vão para a raiz.
- **Formato:** `Ferramenta(conteúdo)`, ou só `Ferramenta` sem conteúdo, em `permissions.allow`.
  - O merge não duplica e preserva as outras chaves e a ordem.
  - Se o arquivo da raiz não é um objeto JSON válido, ele não é reescrito, e o card recebe o aviso "regra não gravada no .claude/settings.local.json: …".
- **Worktree nova:**
  - O `.git/info/exclude` recebe `.claude/settings.local.json` (junto com `.flightdeck/worktrees/`) antes do `git worktree add`, e o arquivo da raiz é copiado para a worktree.
  - A linha do exclude também é garantida a cada execução do card e logo antes de gravar uma regra na raiz. Assim valem as worktrees criadas antes desta fase.
  - Se o repositório versiona o arquivo, a cópia é pulada: a worktree já tem o que está commitado, e sobrescrever mostraria uma alteração no diff.
- **`rules.remove`:** sem `confirm: true` dá `invalid_state`; uma regra que não existe dá `not_found`.
- **Mais de um projeto no mesmo repositório:** não acontece, porque o caminho de um projeto é único.

## App

- **Barras:** só as de 5 horas e de 7 dias, na ordem; outras janelas que o daemon conheça não aparecem.
  - Sem leitura, a barra mostra "sem leitura".
  - O texto da idade é "lida agora", "lida há N min" ou "lida há N h".
- **Notificação:** uma por host, janela e `resetsAt`. A janela seguinte, com outro reinício, pode notificar de novo.
- **Painel de uso:** fica na tela do host.
- **Seção Regras:** fica na edição do projeto, na tela Projetos.
- **"Sempre neste projeto":** o campo leva a regra inteira (`Bash(npm test:*)`). O texto é convertido em `addRules` para `localSettings`, e a validação é do daemon.
- **Pedidos do terminal:** os botões novos também aparecem na tela da sessão externa. Na fila "Precisa de você" continuam só Permitir e Negar.

## Rebase sobre a trilha A

- **`features`:**
  - O `host.info` anuncia `quota` quando o daemon tem a cota do host e `rules` quando tem projetos (o board).
  - O teste de compatibilidade da trilha A passou a esperar `rules` na lista de um daemon com board.
- **No app:** são recursos nascidos na Fase 7, então um host sem o anúncio, inclusive um da Fase 6 sem `features`, não os mostra e não pede nada que gere banner de erro.
  - As barras de cota e o painel de uso dependem de `quota`.
  - Os botões "permitir nesta sessão" e "sempre neste projeto" (gerenciada, card e terminal) e a seção Regras dependem de `rules`.
  - O `quota.get` da conexão continua silencioso quando o host não o conhece.
- **README:** o aviso conhecido do canal ficou só com o texto da trilha A, que tinha o mesmo bullet.
- **Migração:** a trilha A não acrescentou nenhuma, e a `usage_daily` é o índice 5.
- **`test(central-ui)`:** o commit saiu no rebase, porque a trilha A fez a mesma correção do setup.
- **Versões:** a trilha B não mexe em versões, `tauri.conf.json` nem `src-tauri`.

## TDD e testes

- **Escopos:** só os oito da tabela. O gatilho `[ratelimit:…]` do FakeRuntime entrou em `cota`, e `[bash]` e as sugestões entraram em `permitir-sempre`.
- **Smoke:** o `smoke:limits` foi commitado vermelho dentro de `test(regras-projeto)`, falhando no passo "responder com regra do projeto" (o arquivo da raiz).
- **Ramos revelados pela cobertura** seguiram a regra 7: o ramo saiu, o teste ficou vermelho e só então o ramo voltou.
  - A ligação `onQuota` no `startDaemon`.
  - O formato padrão de hora.
- **Teste de tempo:** a espera do `engine-parallel` subiu para 15 s; sob carga, duas worktrees com git real passavam de 5 s.
- **Falha intermitente da Fase 5 observada:** `central-ui` ("junta gerenciada, externa e do histórico…") falhou uma vez na suíte inteira com a ordem de dois itens trocada e passou 3 de 3 sozinho. Parece empate de horário, e não foi mexido nesta trilha.

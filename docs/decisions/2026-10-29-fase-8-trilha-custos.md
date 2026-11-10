# Decisões e divergências da Fase 8, trilha A (custos) (phase 8)

## Uso por mensagem

- **Indexador próprio:** o uso não é lido pelo `HistoryIndexer` da Fase 3. Ele vem de um `UsageIndexer` com offsets próprios na tabela `usage_files`, que vai além da spec.
  - Assim, a carga inicial lê do começo os transcripts que a Fase 3 já tinha indexado, sem reindexar o histórico.
  - Cada mudança vista pelo histórico (`onChange`) pede mais uma passada. Pedidos feitos durante uma passada viram uma só.
  - O subagente escrevendo enquanto a sessão-mãe espera entra na passada seguinte, quando o transcript da mãe recebe o resultado da ferramenta.
- **Deduplicação:** `INSERT OR IGNORE` por `message_id`. Vale a primeira linha da mensagem, porque as outras repetem o mesmo `usage`. Uma mensagem copiada para outro transcript (retomada com fork) fica com a sessão em que apareceu primeiro.
- **Respostas `<synthetic>`:** os erros que o próprio CLI escreve, com uso zero, não entram. Sem isso, apareceriam como modelo sem preço.
- **Sem `timestamp` ou sem `message.id`:** a linha não entra no uso.
- **`origin`:** a prioridade é workflow (etapa em `step_runs`), card (`card_runs`), app (`sessions`) e terminal. Os transcripts de `subagents/` ficam com `subagent` e com a sessão-mãe.
  - Uma entrada lida como terminal é reclassificada na passada seguinte quando uma sessão gerenciada ganha aquele `claudeSessionId` depois.
- **Projeto de card e workflow:** a `projectKey` vem da pasta do projeto do card, não do cwd da sessão. A worktree some ao concluir ou descartar o card, e o cwd apagado cairia em `host:<id>:<cwd>`.
- **Carga inicial:** o progresso no `costs.status` é o da primeira passada do processo. Ela não é persistida: depois de reiniciar, a primeira passada é incremental e rápida, e mostra o progresso do mesmo jeito.
  - Um arquivo apagado durante a carga é pulado.
  - Uma falha numa passada vai para o log, e a passada seguinte tenta de novo.
  - O fim da carga também vai para o log.
- **Painel de uso da Fase 7:** o `usage.summary` e o `usage_daily` continuam iguais. O app passa a ler o `costs.summary` dos últimos 7 dias quando o host anuncia `costs`, sem a coluna de turnos.

## Preços

- **Fonte:** a tabela de preços de API da spec (`docs/SPEC-fase-8.md`), cacheada pelo orquestrador em 06/10/2026 da página de preços da Anthropic. Ela está em `PRICING_DATE`, que o `costs.status` informa.
- **Cache read do Haiku 5.5:** a tabela não traz. Entrou US$ 0,01 por milhão, a regra geral da API (0,1× o input).
- **Tier:** o tier troca o input e o output, e a escrita de cache usa o input do tier. A leitura de cache fica com o preço do modelo, porque a spec só dá input e output no tier. Com mais de um tier, vale o último que o prompt passa (os tiers ficam em ordem crescente).
- **Fast mode:** o multiplicador vale para a mensagem inteira.
- **Modelo:** o nome tem que bater exatamente. Um nome desconhecido aparece como "sem preço", e a config pode dar preço a ele.
- **Config:** `pricing.models` substitui o modelo inteiro, não campo a campo. Os multiplicadores sobrescrevem um a um.
  - O padrão gravado na config é vazio, então uma tabela nova de uma versão futura não fica presa num arquivo antigo.
  - O `costs.reprice` relê a config do arquivo, então dá para trocar o preço sem reiniciar o daemon.
- **Conferência com o SDK:** compara o total calculado da sessão, com as subagentes, ao último `total_cost_usd` da sessão gerenciada com o mesmo `claudeSessionId`.
  - Entra na lista quando a diferença passa de 10% e de US$ 0,05.
  - O modelo informado é o que tem a maior parte do custo.
  - Enquanto a carga inicial roda, a lista fica vazia, porque um custo parcial pareceria divergência.

## Resumo e protocolo

- **Período:** `from` e `to` são dias, no fuso do host, inclusive. Período invertido dá `bad_request`.
  - O app calcula o dia de hoje no fuso da própria máquina. Um host remoto em outro fuso pode ter um dia de diferença na borda.
- **Economia do cache:** é o custo da mensagem com o cache read cobrado como input, menos o custo real, com o mesmo tier e o mesmo fast mode.
- **Top sessões:** trazem o `sessionId` gerenciado, para abrir a sessão ao vivo. O título vem do nome em `session_meta` ou do título do histórico, e o cwd do histórico ou da sessão gerenciada.
- **Comandos além da spec:** `costs.sessions` (custo de várias sessões, para a lista), `costs.card` e `costs.run` (soma das sessões de um card e de uma execução), e `budget.watch`, que liga os frames `budget.updated` como o `quota.watch` da Fase 7.
- **CSV:** `costs.export` devolve `{ csv, filename }`.
  - O custo vai com 6 casas e fica vazio para modelo sem preço.
  - Campos com vírgula, aspas ou quebra de linha vão entre aspas.
  - A ordem é dia, projeto, modelo e origem.

## Orçamentos

- **`budget_alerts`:** a tabela vai além da spec e guarda os limiares já cruzados por orçamento e período. Um reinício nunca alerta duas vezes.
- **Um frame por avaliação:** se o gasto pula vários limiares de uma vez, o `budget.updated` traz só o maior. Todos ficam registrados, e o app notifica uma vez.
- **Quando é notícia:** o frame sai quando o orçamento muda, quando cruza um limiar, quando o período vira e quando começa ou para de segurar cards. Um gasto que não cruza nada não gera frame. O app relê a lista ao abrir Configurações.
- **Virada de período:** é conferida a cada minuto e depois de cada passada de uso. Não há timer até a meia-noite ou até o fim do mês, porque um mês passa do limite de 2³¹−1 ms dos timers.
- **Fila:** a prioridade é cota, depois orçamento, depois vaga. A fila escolhe o card mais antigo cujo escopo não está bloqueado, então um projeto parado não segura os outros. Uma etapa de workflow em andamento não espera pelo orçamento: só cards novos esperam.
- **Projeto:** o orçamento usa a `projectKey` da Fase 5. No app ela é digitada, porque a lista de projetos do board não traz a chave.

## Histórico da cota

- **`window`:** a coluna mantém o nome da spec. No bun:sqlite, `window` funciona como nome de coluna sem aspas.
- **Janela atual:** são as amostras com o mesmo `resets_at` da última. A regressão usa os tempos centrados na média, e o `exhaustsAt` é arredondado para o minuto que o app mostra.
- **Quem consumiu:** são as entradas desde `resets_at − 5 h` até agora. Sem `resets_at`, desde 5 h atrás. Projetos sem custo não aparecem.
- **Retenção:** as amostras ficam 30 dias, número fixo da spec. A `retention.usageDays` (400 por padrão) entrou junto, na mesma área, porque as duas mudam as contagens da limpeza (`usage_entries` e `quota_samples` nas `PruneCounts`).

## App

- **Exportar CSV:** usa o diálogo de salvar da File System Access API (`showSaveFilePicker`), que o WebView2 do Windows tem.
  - Assim a casca Rust fica intocada, sem plugin de diálogo nem de arquivos, e a trilha B pôde mexer nela sem conflito.
  - Sem a API (WebKit no macOS e no Linux), o app avisa que salvar está indisponível.
  - Cancelar o diálogo não mostra nada.
  - Falta conferir no app real que o WebView2 abre o diálogo.
- **Telas:** as telas de custos ficaram funcionais e sem acabamento visual, porque vão para a base nova de interface da Fase 10.
  - O gráfico por dia é de barras em divs.
  - O gráfico da cota é um SVG simples.
- **Custo da sessão aberta:** aparece quando o app conhece o `claudeSessionId` da sessão pela lista da tela Sessões, e é relido quando o estado da sessão muda.
- **Alertas em "Precisa de você":** mostram os orçamentos que cruzaram algum limiar no período atual e abrem Configurações. Somem sozinhos no período seguinte.

## TDD e testes

- **Ordem das áreas:** `uso-mensagens` veio antes de `precos`. A tabela de preços, o `costs.reprice` e a conferência com o SDK dependem das entradas.
- **Migrações:** uma por área, só acrescentadas no fim.
  - Uso e offsets na área de uso.
  - Orçamentos e alertas na área de orçamentos.
  - Amostras da cota na área do histórico da cota.
  - O teste da Fase 7 deixou de fixar o índice da `usage_daily`.
- **Testes antigos ajustados em commits `test(...)`, antes de cada `feat`:**
  - as contagens da limpeza (retenção e backup);
  - o padrão de `retention`;
  - o fixture do desktop;
  - a lista de comandos do teste de protocolo.
- **Ramos revelados pela cobertura** seguiram a regra 7: o ramo saiu, o teste ficou vermelho e só então o ramo voltou.
  - Pasta de sessão sem `subagents/`.
  - O `invalid_state` dos comandos novos sem o recurso.
  - A troca de host da tela Custos.
  - O dia padrão do app.
- **Vermelho do `smoke:costs`:** o script foi escrito depois das áreas que ele cobre e passou na primeira execução. Ele foi commitado no `test(smoke-costs)`.
  - O vermelho veio depois, rodando o mesmo script e os fixtures numa cópia da base sem a trilha A (`git archive 93b06fd`, numa pasta descartável).
  - Saída: `SMOKE COSTS FAIL no passo "carga inicial": costs.status: bad_request`, com código 1. É uma falha controlada no passo certo.
- **Fixtures:** os transcripts de uso foram escritos à mão em `apps/daemon/test/fixtures/history/`, com `__CWD__` substituído na cópia.
  - `usage-main.jsonl` tem uma mensagem em três linhas, fast mode, cache de 5 min e de 1 h, uma mensagem sem a divisão do cache, um modelo sem preço e uma resposta `<synthetic>`.
  - `usage-subagent.jsonl` tem uma mensagem em duas linhas.

## Rebase sobre a trilha B

- **Paleta:** o App passa `costs={true}` ao `GlobalSearch`, e o destino `{ kind: "costs" }` abre a tela Custos. A ação só aparece quando algum host anuncia `costs`.
- **Pastas temporárias:** os testes da trilha usam o `tempDir` dos helpers, que já é o `realTempDir` da área "plataforma". O `smoke:costs` passou a usar o `realTempDir` direto.
- **Conflitos:** foram resolvidos mantendo os dois lados, com a trilha B primeiro.
  - O fixture do desktop (terminal e os arquivos salvos).
  - Os imports do store (bandeja e terminal).
  - O `saveFile` ao lado do `terminal` na plataforma Tauri.
  - O botão de terminal ao lado do custo na sessão.
  - A linha de resumo ao lado do custo na tela Sessões.
  - O `smoke:update` e o `smoke:costs` no `package.json` e na CI.
  - O README e as decisões.
- **Migrações:** a trilha B não acrescentou nenhuma. As da trilha A continuam no fim, na ordem: uso e offsets, orçamentos e alertas, amostras da cota.

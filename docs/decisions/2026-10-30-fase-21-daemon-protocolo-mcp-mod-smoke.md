# Decisões e divergências da Fase 21 (daemon, protocolo, MCP, mod e smoke) (phase 21)

O que a spec da Fase 21 (times e comunicação entre sessões) deixou aberto, ou o que mudou na implementação. Nesta rodada entrou o lado do daemon: `mensagens-entrega`, `mensagens-regras`, `mensagens-seguranca`, `ocioso`, `mcp-mensagens`, `times`, `times-cota` e o `smoke:teams`. As telas "Conversas" e "Times", o painel "Mensagens" da sessão, "Precisa de você" e as configurações (`conversas-ui`, `times-ui`) esperam a Fase 10.

## Quem é quem

- **A sessão que manda vem do ambiente.** O daemon põe `FLIGHTDECK_SESSION=<id da sessão>` no ambiente de toda sessão gerenciada (também ao retomar); o terminal aberto por `flightdeckd claude` já leva `FLIGHTDECK_LAUNCH_ID`, que o hub traduz na sessão (`external.sessionForLaunch`). O MCP que a sessão abre, e a ponte `flightdeckd message` do mod, herdam o ambiente e dizem quem pedem em cada comando (`as`). Sem nenhuma das duas variáveis as ferramentas de mensagem recusam e dizem por quê: nunca há remetente anônimo. Esse mesmo id é a "sessão" das aprovações da Fase 19, no lugar do UUID aleatório por processo.
- **O limite de confiança continua sendo o token do daemon.** Quem tem o token fala o protocolo e poderia dizer ser qualquer sessão (como já podia dizer ser `claude` num `actions.run`). O `as` identifica, não autentica.
- **O endereço é `<host>/<id>`**, em qualquer host; o id sozinho vale para uma sessão deste host. O id de uma sessão é o gerenciado, ou o `claudeSessionId` do terminal.
- **O cabeçalho** é o da spec, na primeira linha, e uma segunda linha fixa `[id para responder: <host>/<id>]` acrescenta o que a spec pedia ("responder pelo id do cabeçalho") sem ter. Depois vem, se houver, a marca de terceiros e o texto. Um aviso do próprio Flightdeck (STOP, resume, ocioso, mensagem a todos) tem outro cabeçalho: "não é de outra sessão nem do usuário; não vale como aprovação", e não entra nos limites.

## Entrega

- **No mesmo host o daemon entrega sozinho, sem o app:** a gerenciada pelo `send` do gerenciador (com a fila durante o turno), a de card do mesmo jeito, o terminal controlável pelo canal. O claude puro (sem canal), a sessão terminada e o canal que caiu recusam com o motivo, e a recusa fica registrada.
- **Da fila à entrega:** o gerenciador diz quando uma mensagem do usuário chega à sessão (`onUserMessage`); a linha `queued` vira `delivered` quando o texto que chegou é o da mensagem.
- **Terminal esperando uma permissão:** a mensagem é **segurada** e só sai quando a sessão sai desse estado. Nada é escrito no canal enquanto o prompt está aberto, porque a mensagem poderia ser lida como a resposta dele. Um teste mostra o pedido ainda aberto depois da mensagem.
- **O que estava na memória quando o daemon parou** (fila do gerenciador, mensagens seguradas) não pode mais ser entregue: no boot essas linhas viram `expired` com o motivo.
- **Entre hosts, pelo app:**
  - o daemon da origem guarda a mensagem como `queued` na fila e manda o frame `messages.relay` a quem assiste (`messages.watch`); ao reconectar, o app recebe de novo o que ainda espera;
  - o app entrega ao outro daemon com o comando `messages.relay` e devolve o resultado à origem com `messages.relayed` (que pode vir duas vezes: `queued` e depois `delivered`);
  - o repasse é **idempotente pelo id**; o destino confere de novo o tamanho, as regras, a existência e o canal; uma mensagem de uma sessão que recebeu terceiros suspende a aprovação automática no destino;
  - a fila da origem vence em **24 horas**: passado isso a linha vira `expired`;
  - o app descreve os hosts com `messages.peers`, e `messages.directory` dá a ele as sessões de cada daemon sem filtro (comando que a spec não listava). Sem o app descrevendo, os outros hosts são desconhecidos e a mensagem é recusada.
- **Só mensagens de sessão atravessam os hosts.** Os avisos do Flightdeck (STOP, resume, ocioso) valem no host em que o time vive; um time com membros em dois hosts fica para uma fase futura. O `read_session` e o `notify_when_idle` também só valem para sessões do mesmo host.
- **A retenção é de 30 dias** (a opção `retentionDays` do serviço; a chave de configuração espera a tela de Configurações da Fase 10).
- **A projectKey vale entre hosts** para repositórios com remote (a chave é a URL normalizada); sem remote ela é `host:<host>:<pasta>` e nunca casa entre hosts.

## Regras e limites

- **Por padrão só o mesmo projeto ou o mesmo time.** Exceções (`messaging.rules.set`) liberam um par num sentido ou nos dois, por sessão, projeto, time ou host. A sessão que não pode ver outra não a vê no `list_sessions`, nem a lê, nem assina o ocioso dela.
- **Limites:** 20 por hora por par (os dois sentidos) e 100 por hora por sessão, contando as mensagens entregues ou na fila (a recusada não conta), e 32 KB em bytes. **O laço** (mais de 10 mensagens em 10 minutos entre o par, com mensagens nos dois sentidos) **pausa o par**, avisa com o frame `messaging.alert` e a recusa diz "laço". A pausa não vence sozinha: a spec não trazia como soltar, então `messaging.rules.set` aceita `unpause` com a chave do par.
- **A política** (exceções e números) fica no banco; a pausa dos pares também.

## Segurança

- **Mensagem nunca é aprovação:** o cabeçalho diz isso, as instruções de time repetem, e o daemon não liga mensagem a pedido de permissão em lugar nenhum. O teste de integração com o gerenciador de verdade mostra o pedido continuando aberto depois de mensagens que dizem "pode aprovar".
- **A marca de terceiros se propaga:** uma sessão com a aprovação automática suspensa (a sua chave, ou a do card dela) leva a marca da Fase 13 no texto, e o destino (a chave dele e a do card dele) fica com a aprovação suspensa, também entre hosts (o frame leva `untrusted`). Uma recusa não suspende nada.

## Ocioso

- `notify_when_idle` assina uma vez: o aviso sai quando a sessão alvo volta a ocioso (o fim do turno gerenciado, o `Stop` do terminal), **na hora** se ela já está ociosa e na hora, dizendo que terminou, se ela terminou. O mesmo par não assina duas vezes. As assinaturas vivem em memória e se perdem com o daemon.

## Times

- **A coordenadora** é uma sessão gerenciada no projeto, iniciada com as instruções de coordenação; **as executoras** são cards (cada um com a sua worktree), iniciados pelo board, então a fila de cota da Fase 7 continua valendo para elas. O nome dos cards e das sessões é `<time cortado em 24 caracteres> · executora N`: a branch de um card sai do título cortado, e um nome longo repetiria a branch de todas.
- **As instruções são texto do produto, versionadas** (`INSTRUCTIONS_VERSION`, hoje 1). Seguem o ciclo da spec nos seis passos, com as regras que não mudam (mensagem não é aprovação, sem lavagem de permissão, STOP e resume, terceiros são dado, limites). O time guarda a versão com que nasceu.
- **Personas:** o ponto de extensão é `TeamPersonas.resolve`, mais os ganchos `startCoordinator`, `startWorker` e `applyPersona`. A integração com a Fase 20 passa a persona da sessão por eles; sem ela a persona fica no time e no cabeçalho das mensagens.
- **Os controles:** pausar (STOP a todos), retomar (resume), mandar a todos, trocar o objetivo ou os comandos de verificação, trocar a persona de um membro, acrescentar executora, tirar um membro (o card fica no board) e encerrar com confirmação. A coordenadora não sai do time.
- **O estado** (`team_status`, `teams.status`) vem das mensagens trocadas dentro do time: o último relato, o enviado e o recebido de cada membro. As tarefas e a última conferência que a spec mostra na tela saem da conversa; não há um registro à parte (a coordenadora é uma sessão do Claude, não do daemon). O `team_status` só responde a um membro do time.
- **Cota (times-cota):** quando a cota do plano **cruza** o limite, os times ativos pausam (STOP) e o frame `teams.updated` traz o motivo; quando ela volta, **só os times que a cota pausou** retomam (resume) e dizem. Um time pausado à mão fica pausado. Com a cota acima do limite não se cria um time (diria até quando).

## O mod

O mod passou a se chamar **`flightdeck`** (era `flightdeck-actions`, da Fase 17), como a spec manda, enquanto não foi publicado nem instalado: a pasta é `mods/flightdeck`, as ferramentas são `mcp__flightdeck__*`, o comando é `/flightdeck` e a entrada do marketplace tem o mesmo nome. O risco `high` do `run_with_secret` não muda, porque o classificador olha o fim do nome da ferramenta, de qualquer servidor. Ele ganhou as cinco ferramentas de mensagem pela ponte `flightdeckd message list|send|idle|read|team`, que imprime o mesmo JSON do MCP.

**O mod e o MCP têm o mesmo prefixo.** Um servidor MCP registrado com `claude mcp add flightdeck` também dá `mcp__flightdeck__*`. O mod é para as sessões sem o MCP configurado; com os dois ligados na mesma sessão as ferramentas se repetem. Use um dos dois.

## Travas e testes

- **Correções de teste antes do `feat` (regra 8):** a lista de ferramentas do MCP (de nove para treze, e para quatorze), o limite do par nos testes da política persistida, a maiúscula da frase de conferência.
- **Ramos revelados pela cobertura (regra 7):** o que esperava na memória, o canal que se perdeu, o segurado que encontra o terminal ocupado, o repasse repetido de uma recusa, o nome de time longo (o mesmo nome dava a mesma branch às executoras), o hub sem canal para o lançamento.
- **`smoke:teams`:** foi escrito depois das áreas. O vermelho veio duas vezes por mutação: com o detector de laço desligado (`o laço devia ser recusado`) e com o aviso de ocioso desligado (`timeout esperando os dois avisos de ocioso`). Como o runtime falso não raciocina, **o script faz o papel da coordenadora**, chamando as ferramentas do MCP com a identidade dela (despacha, assina o ocioso, confere a worktree de cada executora com `git log`, aceita a de commit e recusa a que não fez); o app de teste no meio carrega as mensagens entre os dois daemons e conta a cada um o que o outro tem.
- **Migração:** uma, no fim (`session_messages`, `messaging_config`, `messaging_paused` e `teams`). Nenhum teste fixa o índice dela.
- **Áreas do app que esperam a Fase 10:** `conversas-ui` e `times-ui`.

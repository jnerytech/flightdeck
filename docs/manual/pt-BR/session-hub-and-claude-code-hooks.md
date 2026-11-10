# Central de sessões e hooks do Claude Code

[Voltar ao manual](../pt-BR.md) · [English](../en/session-hub-and-claude-code-hooks.md)

A tela **Sessões** é a principal do app: todas as sessões do Claude Code dos hosts online, num
lugar só, agrupadas por projeto e ordenadas pela última atividade.

- **Projeto primeiro.** Cada projeto é um grupo com um título em negrito (uma pasta, o nome, um chip
  **ao vivo/total** e um chip por host, que abre a página do host). **Todo projeto começa
  recolhido**, mostrando só o cabeçalho e as sessões que precisam de você; abra um pela seta, e a
  escolha é lembrada por projeto. **Expandir tudo** e **Recolher tudo**, no topo, fazem isso com
  todos. Aberto, o projeto mostra primeiro as sessões ao vivo (as que precisam de você no topo). As sessões encerradas e do histórico ficam atrás de **N sessões anteriores**, da mais
  nova para a mais antiga. Digitar no filtro também casa com o nome do projeto, e qualquer filtro (texto, origem,
  estado, persona, fixadas) abre tudo o que ele mantém. Escolher um host em **Dados de** só restringe
  a lista a esse host: os projetos ficam abertos ou dobrados como você os deixou. A dobra de um projeto é
  lembrada sob uma chave que não muda quando um host fica offline ou pastas se juntam. Uma sessão fixada fica sempre com as ao
  vivo. **O mesmo projeto em dois hosts é um só grupo**, com os dois chips de host, e cada linha
  mantém o seu chip de host. Um projeto sem remote git é reconhecido pelo nome da pasta entre
  hosts, mas nunca quando um host tem duas pastas com esse nome: essas ficam em grupos separados em
  todo lugar. Grupos que repetem o nome mostram uma **dica de caminho** curta (a pasta acima do
  projeto, por exemplo `work`) ao lado do título e no nome dele para leitores de tela. **Dados de**
  na barra (com dois hosts ou mais) lista as sessões de um host ou de todos, a mesma escolha do
  Início; **Ver todas as sessões** na página de um host olha esse host na visita sem mudá-la.
- **Títulos.** A sessão se chama pelo nome, senão pelo título que o host dá a ela (o resumo que o
  Claude Code escreveu, ou o primeiro prompt), senão pela persona com a tarefa, senão pela pasta. Os invólucros do
  sistema (`<task-notification>`, "Another Claude session sent a message:", saída de comando
  local) nunca aparecem num título.

## O que aparece na lista

| Origem | De onde vem |
| --- | --- |
| Flightdeck | sessões que o próprio daemon roda (`session.list`) |
| terminal | sessões abertas fora do Flightdeck, no terminal ou no terminal integrado do VS Code, vistas pelos hooks do Claude Code (`external.list`) |
| histórico | transcripts indexados de `~/.claude/projects` (`history.list`) |

Uma sessão aparece uma vez só. A ordem de preferência é gerenciada, depois terminal, depois
histórico.

- **Grupo:** é o projeto. Vale o `remote.origin.url` do repositório da pasta da sessão,
  normalizado, de modo que SSH e HTTPS do mesmo repositório caem juntos. Worktrees contam como o
  repositório principal. Sem remoto, vale a raiz do repositório; sem repositório, a pasta. A pasta
  é aquela em que a sessão começou, onde fica o seu transcript: uma sessão de terminal que depois
  trabalha em outra pasta continua no seu projeto.
- **Linha:** mostra host, origem (uma sessão de terminal tem o selo "terminal"), estado (rodando, precisa de você, ociosa, encerrada), o selo
  "controlável" e a hora.
- **Resumo:** abaixo, uma linha tirada do transcript, sem IA: "Pedido: <primeira linha do último
  prompt, até 80 caracteres>" e o que a sessão faz agora ("rodando Bash", "esperando aprovação de
  Write", "ociosa há 12 min"). O daemon manda isso no campo `summary` das listas.
- **Visualização:** os dois botões no início da barra (**Lista** e **Cartões**) trocam o jeito de
  desenhar as sessões. O cartão mostra o título (clique para abrir), o projeto, o host, a bolinha de
  estado, a persona, o custo (nos hosts que informam) e a última linha (o pedido e o que a sessão
  faz, como a ferramenta esperando aprovação), com o mesmo menu de uma linha. Os cartões ocupam
  quantas colunas a largura permitir. A escolha fica guardada.
- **Filtros:** texto, host, origem, estado, "Só fixadas" e "Mostrar arquivadas". As arquivadas
  ficam fora por padrão.
- **Menu:** renomear, fixar (as fixadas vão para o topo do grupo), arquivar e "Copiar comando"
  (`flightdeckd claude --resume <id>`).
- **Abrir uma sessão:**
  - gerenciada: abre a conversa;
  - do terminal ainda viva: abre o transcript ao vivo, com os pedidos de permissão dela e, se for
    controlável, a caixa de mensagem;
  - encerrada ou do histórico: abre o leitor, com "Continuar no Flightdeck".

## A caixa de mensagem

- Na caixa de mensagem de uma sessão dá para **colar ou soltar imagens** (PNG, JPEG, GIF ou WebP,
  até cinco por mensagem e 5 MB cada; o host precisa suportar). Elas aparecem como miniaturas que
  dá para remover antes de enviar, e a conversa indica quantas imagens a mensagem levou. Um
  arquivo que não cabe diz o motivo em vez de ser anexado.
- Enquanto um turno roda, **Enfileirar** (ou Enter) põe a mensagem numa lista **Na fila**
  acima da caixa, em vez de enviá-la. **Editar** devolve a mensagem para a caixa e **Remover** a
  descarta; quando o turno termina, as mensagens da fila saem em ordem, uma por turno.
- **Enter** envia a mensagem; **Ctrl+Enter** (ou Shift+Enter) quebra a linha. O ícone de envio
  (↵) aparece quando a caixa tem texto. Digitar `/` oferece os snippets e os comandos da sessão.
- Sob cada mensagem do assistente há uma linha que aparece ao passar o mouse ou ao focar pelo
  teclado: **Copiar mensagem**, **Bifurcar a partir daqui** (na última mensagem: leva a conversa
  inteira até ali), **Fixar sessão** e há quanto tempo a mensagem foi escrita.
- A caixa flutua no fim da tela como um cartão arredondado. O **+** anexa imagens (quando o host
  suporta). Sob o cartão, uma linha de estado mostra o modelo e o modo de permissão, e um
  indicador girando enquanto um turno roda. Quando a sessão deixa mudar, o modo é um **chip** (por
  exemplo "Padrão"): clique nele, ou foque e tecle Enter, para abrir o menu **Modo** com todos os
  modos, o que cada um faz e seu número (tecle 1 a 4 para escolher). **Shift+Tab** na caixa
  alterna entre Padrão, Aceitar edições e Planejar. **Ignorar permissões** também está no menu,
  mas o ciclo nunca cai nele: ele pergunta antes, citando o host e a sessão, e o chip fica
  vermelho enquanto está ligado. Em um host com a chave desligada (ou para um modo mais solto que
  o da partida da sessão) a linha fica esmaecida, diz por quê e leva às configurações do host. O
  modelo também é um chip ("Opus 5.5 · Médio"): o menu **Modelo** lista Padrão, Opus, Sonnet e
  Haiku com para que serve cada um e seu número (tecle 1 a 4), **Mais modelos** traz as versões
  específicas, e **Esforço** (num host que suporta) define Baixo, Médio, Alto, Muito alto ou Máximo
  para os próximos turnos, ou volta ao nível do próprio modelo. Uma sessão do OpenCode mantém uma
  lista simples dos seus modelos. Durante o
  turno, uma linha acima da caixa diz o que está acontecendo ("Executando um comando", "Editando
  arquivos", "Esperando você") e há quanto tempo; o indicador para de girar se o sistema pedir
  menos movimento.
- **Esperando num botão:** um botão cujo comando está rodando ignora um segundo clique na hora.
  Em menos de um décimo de segundo nada muda na tela; até um segundo ele só parece ocupado; a
  partir de um segundo mostra um indicador girando; depois de três segundos diz também **Ainda
  trabalhando…** (ou a etapa, quando o comando informa uma). Uma lista ou painel carregando só
  desenha os marcadores se a espera passar de dois décimos de segundo, então uma carga rápida não
  pisca.

## Hooks do Claude Code

As sessões abertas fora do Flightdeck só aparecem com os hooks instalados no host. Há dois
caminhos, e ambos são opt-in: na tela do host, o botão **Instalar hooks**, que pede confirmação,
ou no terminal do host:

```sh
flightdeckd hooks install     # grava as entradas do Flightdeck em ~/.claude/settings.json
flightdeckd hooks status      # instalados, ausentes ou desatualizados
flightdeckd hooks uninstall   # remove só as entradas do Flightdeck
```

- **O que é escrito:** é a única escrita do Flightdeck em `~/.claude`.
  - O `install` mescla as entradas com o que já existe, sem tocar nas outras chaves nem nos hooks
    de terceiros.
  - Antes, guarda uma cópia em `settings.json.flightdeck-backup`.
  - Reinstalar substitui as entradas antigas em vez de duplicar.
- **Entradas:**
  - `SessionStart` é um hook de comando:
    `<flightdeckd> hook session-start --url <receptor> --token <token>`. No Windows, o Claude Code
    roda hooks de comando pelo Git Bash, que trata `\` como escape. Por isso o caminho do
    executável é gravado com barras normais (`D:/...`). Uma instalação antiga, com barras
    invertidas, aparece como desatualizada no `hooks status`: rode `hooks install` de novo.
  - `UserPromptSubmit`, `Notification`, `PermissionRequest`, `PostToolUse`, `PostToolUseFailure`,
    `PermissionDenied`, `Stop` e `SessionEnd` são hooks http para o receptor do daemon, em
    `http://127.0.0.1:<hooks.port>`, com o cabeçalho de token.
- **Config:** `hooks.port` vale 7421 por padrão. `hooks.token` é gerado no primeiro install.
  `hooks.permissionTimeoutS` vale 600. `hooks.staleAfterS` vale 900; uma sessão sem eventos e sem
  mudança no transcript por esse tempo passa a encerrada.
- **WSL:** o daemon do WSL instala no `~/.claude` do WSL e precisa de um `hooks.port` diferente do
  Windows.
- **Instalar pelo CLI com o daemon rodando:** o daemon passa a receber os hooks depois de
  reiniciado (`flightdeckd service stop` e `service start`). Instalando pelo app, o receptor sobe
  na hora.
- **O Claude nunca espera pelo Flightdeck:**
  - Com o daemon fora do ar, os hooks falham rápido e a sessão segue.
  - Sem nenhum app aberto, o pedido de permissão é respondido na hora, vazio, e o diálogo do
    terminal decide.

## Aprovar sessões do terminal pelo app

Com o app aberto, o `PermissionRequest` de uma sessão do terminal espera a resposta e aparece em
**Precisa de você**, com notificação do sistema. Enquanto isso, o diálogo do terminal continua
ativo. Vale o que vier primeiro:

- **Aprovar ou Negar no app:** libera ou nega a ferramenta.
- **Responder no terminal:** o pedido sai da fila no próximo evento da sessão.

Nada é aprovado sem um clique.

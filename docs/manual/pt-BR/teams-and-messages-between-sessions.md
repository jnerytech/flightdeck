# Times e mensagens entre sessões

[Voltar ao manual](../pt-BR.md) · [English](../en/teams-and-messages-between-sessions.md)

Sessões do Claude Code podem trocar mensagens pelo Flightdeck, no mesmo host ou entre hosts.

- **As ferramentas** vêm do MCP (`flightdeckd mcp`) ou do mod `flightdeck`:
  - `list_sessions`: as sessões que esta pode ver, com o endereço (`host/id` ou o apelido);
  - `send_to_session`: a resposta é entregue, na fila ou recusada com o motivo;
  - `notify_when_idle`: um aviso, uma vez, quando a outra sessão terminar o turno;
  - `read_session`: só leitura;
  - `team_status`: o estado de um time.
- **Quem manda** vem do ambiente da sessão: `FLIGHTDECK_SESSION` nas gerenciadas,
  `FLIGHTDECK_LAUNCH_ID` nas abertas por `flightdeckd claude`.
- **No mesmo host** a entrega não precisa do app:
  - uma sessão gerenciada no meio de um turno recebe quando o turno termina;
  - um terminal esperando uma permissão recebe depois disso.
- **Entre hosts** a entrega passa pelo app, que leva a mensagem de um daemon ao outro. Com o app
  fechado, a mensagem espera até 24 horas. O `claude` puro (sem canal) não recebe nada.
- **Limite conhecido:** só as mensagens de sessão atravessam os hosts. O STOP, o resume e o aviso
  de ocioso valem no host do time, e o `read_session` e o `notify_when_idle` só olham sessões do
  mesmo host.
- **No app:**
  - **Conversas** (barra lateral) lista as mensagens, a mais nova primeiro, com filtros por estado
    e por time;
  - cada sessão tem a aba **Mensagens**, com o que ela mandou e recebeu;
  - nessa aba, **Mandar para outra sessão…** manda uma mensagem da sessão para outra.

## Nomes padronizados de sessão

- **Toda sessão ganha um nome** quando aparece: `projeto · persona · número`, por exemplo
  `flightdeck · revisor · 3`.
  - Sem persona, a persona é `geral`.
  - A sessão de um card leva o número do card: `flightdeck · autor · card 42`.
  - O app mostra o nome no idioma dele, com o nome da persona: `flightdeck · Revisor de código · 3`.
    O alias não muda.
- **Toda sessão ganha também um apelido:** `projeto-persona-número`, por exemplo
  `flightdeck-revisor-3`. O apelido endereça a sessão, sozinho ou como `host/apelido` entre hosts.
- **Um número nunca é reaproveitado**, nem depois que a sessão some.
- **Renomear uma sessão** troca o nome e acrescenta um apelido. O apelido antigo continua valendo.
- **Em Sessões:**
  - um host com nomes mostra os nomes;
  - dentro de cada projeto, as sessões ficam em ordem de nome, depois das que precisam de você e
    das fixadas;
  - **Filtros → Persona** deixa só uma persona;
  - um nome que você deu a uma sessão continua valendo.

## Quem pode falar com quem

- **O padrão:** só falam sessões do mesmo projeto ou do mesmo time.
- **Configurações → Mensagens entre sessões em <host>:**
  - acrescenta exceções por sessão, projeto, time ou host, num sentido ou nos dois (**Nos dois
    sentidos**);
  - define a **retenção** do histórico (30 dias por padrão);
  - lista os **pares pausados por laço**, com **Soltar**.
  - Se o host recusa uma mudança, a seção diz por quê.
- **Limites:**
  - 20 mensagens por hora por par e 100 por hora por sessão;
  - 32 KB por mensagem.
- **Um laço pausa o par:** mais de 10 mensagens de ida e volta em 10 minutos.
  - Você recebe uma notificação, e o par espera em **Precisa de você**.
  - **Soltar o par** deixa o par falar de novo.
- **Mensagem nunca é aprovação:**
  - o cabeçalho diz que ela vem de outra sessão, não de você;
  - nenhuma mensagem responde a um pedido de permissão.
- **Conteúdo de terceiros:** uma sessão que recebeu conteúdo de terceiros passa essa marca
  adiante, e a aprovação automática fica desligada também em quem recebe dela.

## Times

- **Um time** é uma sessão coordenadora e as executoras. Cada executora roda num card, com a
  própria worktree.
- **Times** (barra lateral) cria um time: o projeto, o objetivo, um nome e, se quiser, a persona e o
  modelo da coordenadora. As executoras são linhas: cada uma tem a sua persona e o seu modelo, e
  você acrescenta ou tira linhas (o número de linhas é o número de executoras, de 1 a 8). A
  persona de cada executora começa como o Desenvolvedor, quando o host o tem; escolha **Nenhuma**
  para o padrão simples. Sem escolha, o modelo é o da persona. O modelo de cada membro aparece na linha dele.
- **As permissões de cada membro** são escolhidas na mesma linha (e para a coordenadora):
  **Padrão** (pergunta antes de mudar, ou o modo da persona quando ele é mais restrito), **Aceitar
  edições**, **Planejar** e, só onde o host permite, **Ignorar permissões** (Bypass). Escolher
  Bypass pede uma confirmação antes de criar o time ou acrescentar a executora; um host que o
  proíbe recusa o time antes de qualquer membro começar. As linhas se alinham em colunas: persona,
  modelo, permissões, remover. Um host antigo demais para aceitar os modos não mostra o seletor de
  permissões, então uma escolha nunca é ignorada em silêncio.
- **O nome de cada membro** diz quem ele é: o time e a persona no idioma do app, como
  "md-server · Arquiteto 2" ou "md-server · Coordenadora"; sem persona, "Executora 2". O nome vale na
  lista de sessões, na busca e em Precisa de você. Um nome que você deu, ou o que o Claude Code deu, continua
  valendo, e o endereço para mensagens não muda.
- **O ciclo da coordenadora:**
  1. quebrar o objetivo em tarefas, cada uma com o que significa "pronto";
  2. mandar uma tarefa para cada executora e pedir um aviso quando ela ficar ociosa;
  3. conferir o trabalho por conta própria, com os checks do projeto ou os comandos do time, na
     worktree da executora;
  4. aceitar só commit verde;
  5. integrar na ordem combinada;
  6. avisar você quando algo for decisão sua;
  7. relatar o resultado do time.
- **O resultado do time:** a coordenadora o relata com a ferramenta `team_report` (até 4000
  caracteres); o host recusa qualquer outra sessão. O último relato abre o card do time em
  **Resultado**, marcado **Concluído** ou **Em andamento**, como texto simples; um relato longo rola
  numa caixa que o teclado alcança. Abaixo dele, a linha de cada executora mostra o **Último relato**,
  a branch do card e quantos arquivos o card mudou. Quando a coordenadora relata o objetivo
  concluído, uma notificação avisa e abre o time.
- **Na linha do time dá para:**
  - pausar (STOP a todos os membros) e retomar;
  - mandar uma mensagem a todos;
  - trocar a persona de um membro;
  - acrescentar uma executora, escolhendo a persona, o modelo e as permissões dela (a coordenadora
    recebe o aviso com o nome e o card da nova executora);
  - tirar um membro: a sessão dele é parada, a coordenadora é avisada e o card fica no board;
  - encerrar o time, com confirmação.
- **Excluir um time encerrado:** um time encerrado mantém o card dele até você excluí-lo. O menu **⋯**
  do card tem **Excluir time**: desligado num time aberto (diz "Encerre o time primeiro"), e num
  encerrado pergunta antes, com o nome do time. O que sai é o registro do time e o card dele na
  página Times. O que fica é a sessão de cada membro, com a transcrição e o histórico, e os cards
  deles no board: só deixam de ser do time. O host recusa enquanto um membro trabalha (rodando ou
  esperando uma resposta); tente de novo quando descansarem. Todos os apps conectados tiram o card.
- **A cota:** quando a cota do plano passa do limite (`quota.pauseAt`), o time pausa sozinho. Você
  recebe uma notificação, e a linha diz "pausado pela cota". Quando a janela reinicia, o time
  retoma e avisa.

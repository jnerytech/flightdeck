# Custos, orçamentos e cota

[Voltar ao manual](../pt-BR.md) · [English](../en/costs-budgets-and-quota.md)

## A conta do Claude de um host

A página do host tem um cartão **Conta**, acima do painel de consumo, que mostra em qual conta do
Claude o próprio `claude` do host está conectado. O Flightdeck nunca faz o seu login e nunca vê um
token: ele pergunta ao `claude` já instalado no host (`claude auth status`, mais os relatórios de
conta e de uso do Agent SDK), e os termos da Anthropic não permitem login dentro de apps de
terceiros.

### Qual conta este host está usando?

- O cartão mostra o e-mail da conta, a organização, o plano (Pro, Max, Ultra, Team, Enterprise) e duas
  barras, **5 horas** e **7 dias**, com a porcentagem usada e quando cada uma reinicia (passe o
  mouse para ver a hora exata). As barras de 7 dias do Opus e do Sonnet só aparecem quando o host
  as informa.
- O plano vem do login do `claude` no host, que o guarda desde que você entrou: depois de mudar de
  plano, saia e entre de novo lá e toque em **Atualizar**. As barras são lidas ao vivo e estão sempre
  em dia.
- Ele é lido ao abrir a página e de novo a cada 5 minutos enquanto ela fica aberta, e na hora em
  que uma sessão gerenciada termina um turno. "Última leitura há 2 min" diz o quanto está
  fresco. **Atualizar** lê agora; há 30 segundos de espera entre leituras.
- Cada host tem a sua conta. O e-mail aparece só neste cartão: não vai para notificações, título
  da janela, linha de status nem bandeja, e o daemon o guarda só na memória, nunca no banco nem nos
  logs.
- Se uma leitura falha, o cartão mantém a última e avisa "Não foi possível atualizar". Se o host
  está offline, ele diz isso em vez de mostrar uma leitura antiga.

### E se o host não estiver conectado?

O cartão diz "Este host não está conectado ao Claude." e mostra o comando **`claude auth login`**.
Abra o terminal do host (o botão **Abrir terminal** faz isso), rode o comando lá, siga os passos e
volte: o cartão se atualiza. **Copiar comando** copia. O cartão não tem formulário e nunca pede um
código ou um token.

Um host que usa chave de API ou um provedor de nuvem (Bedrock, Vertex, um gateway) mostra "Os
limites do plano não se aplicam": ele não tem janelas de plano. Se o cartão disser que não foi
possível ler a conta, confira se o `claude` está instalado nesse host e aperte **Tentar de novo**.

## Cota do plano

Cada turno de uma sessão gerenciada traz a cota do plano do Claude. Todas as sessões de um host
usam o mesmo login, então a cota é do host. O daemon guarda a última leitura de cada janela (5
horas, 7 dias e as outras que vierem), e a leitura deixa de valer quando a janela reinicia.

- **Na tela Custos:** numa assinatura o bloco **Cota do plano** abre a tela, com as barras de cada
  host, antes dos dólares (estimados a preços de API, que o plano não cobra). Com chave de API a tela começa pelos dólares.
- **No app:** o topo da tela Sessões mostra, para cada conta do Claude, as barras de 5 horas e de 7
  dias (hosts com a mesma conta compartilham um cartão, com o nome de todos), com a porcentagem, a hora de reinício e a idade da leitura ("lida há 12 min").
  - A barra fica vermelha a partir de `quota.pauseAt`.
  - Cruzar o `pauseAt` gera uma notificação, uma vez por janela.
- **Na barra de status** (a linha fina na base da janela, abaixo): um medidor pequeno mostra a
  janela mais usada entre os hosts online, com a porcentagem e o tempo que falta para reiniciar (o
  nome da janela aparece a partir de 1024 px de largura), e um botão **Atualizar o consumo do plano**
  que pergunta aos hosts de novo. A partir de 80% ele ganha uma marca de alerta na cor de "precisa de
  você", e em 100% (ou a partir do `pauseAt`, como no cartão da conta) a barra fica vermelha; o nome
  e a dica dizem o nível, o host e o tempo que falta. Clicar nele abre um painel com as duas janelas
  de cada host online e a hora em que reiniciam. Nele, **Cartões novos esperam a partir de** muda a
  trava (`quota.pauseAt`) de cada host: de 50% a 100%, ou **Nunca**. Um host com flightdeckd antigo
  mostra só o texto. **Mostrar o que está rodando** abre a atividade de todas as sessões, e cada
  host tem o seu link para a página dele. O aviso de cota alta no cartão da conta traz a mesma
  trava e a mesma ação. Mudar a trava nunca para uma sessão que já está rodando. Sem leitura, nem o
  medidor nem o botão aparecem.
- **Só terminal:** os hooks não trazem a cota. Quem usa só sessões do terminal vê barras vazias ou
  antigas até rodar um card ou uma sessão gerenciada no host.

## A barra de status

Uma barra fina (24 px) corre pela base da janela. À esquerda, a cota do plano (acima) com a hora de
reinício e um botão de atualizar. À direita, cada item abre a sua página:

- **Atualização:** só quando há o que dizer: uma atualização do app disponível, uma já baixada que
  pede reinício, ou uma verificação que falhou. Abre as Configurações.
- **Manter acordado:** o que os hosts que oferecem isso dizem juntos: **Acordado** (segurando o
  computador acordado agora), **Manter acordado** (ligado, segurando só enquanto há sessões) ou
  **Pode dormir** (desligado). Abre a página desse host, onde está a chave. Um host que não oferece
  isso não conta.
- **Terminais:** quantas abas de terminal estão abertas, nas duas áreas. Traz a primeira para a
  frente; sem nenhuma aberta, abre o host onde dá para abrir uma.
- **Hosts:** quantos estão online do total ("2/3"). Abre o primeiro host que não está online, para um
  problema ficar a um clique; com todos online, o host em vista.

Cada item é um botão com as palavras como nome e uma dica, nunca só a cor, e as duas contagens são
regiões vivas, então o leitor de tela ouve quando mudam.
Em uma janela com menos de 600 px de altura a barra fica escondida, para deixar a altura para a conversa.
Em uma janela com menos de 1024 px de largura, as palavras ao lado de um valor vão para a dica e o
nome do botão (os ícones e os valores ficam). Abaixo de 640 px só a cota e o manter acordado ficam
na barra; a atualização da cota, a atualização do app, os terminais e os hosts ficam numa lista
**Mais itens de status** na ponta direita.

## Fila por cota

```json
{ "quota": { "pauseAt": 0.9 } }
```

Enquanto alguma janela válida está em `pauseAt` ou acima (ou foi recusada pelo plano):

- um card iniciado entra na fila com o selo "aguardando cota até HH:MM" e começa sozinho quando a
  janela reinicia;
- um workflow em andamento espera antes do próximo turno de agente, no mesmo ponto em que confere
  o orçamento;
- sessões manuais não são bloqueadas; o app só mostra o aviso.

`"pauseAt": null` desliga a fila por cota.

## Uso

A tela do host mostra os últimos 7 dias de uso, por dia (no fuso do host) e por projeto. Num
host da Fase 8 em diante (que anuncia `costs`), o painel lê os custos de todas as sessões (veja
[Custos](#custos)). Num host da Fase 7, mostra o uso das sessões gerenciadas: custo estimado,
tokens e turnos.

- **Custo:** é a diferença do total que o SDK informa para cada sessão, nunca a soma turno a
  turno.
- **Projeto:** o mesmo da tela Sessões (o remoto `origin`, ou o caminho do repositório).
- **Agrupado por projeto:** cada projeto é um bloco com o total (o mais caro primeiro) e seus
  dias abaixo, do mais novo ao mais antigo. Datas e custos nunca quebram de linha.
- **Ocultos:** pastas temporárias (`temp`, `tmp`, `/var/folders`) e worktrees de agentes
  (`.claude/worktrees`) não aparecem.
- **Abrir as sessões:** clique num dia para abrir o Histórico filtrado pela pasta desse projeto e
  por esse dia. Um projeto conhecido pelo remoto (compartilhado por várias pastas e worktrees)
  abre o Histórico filtrado pelo próprio projeto, então todas as pastas dele aparecem; uma ficha
  "Projeto: nome" acima da lista mostra isso, e **Limpar projeto** a tira.
- **Fora do uso:** as sessões do terminal, porque os hooks não trazem custo.

## Custos

A tela **Custos**, no menu lateral, mostra o custo de todas as sessões de um host: do terminal,
do app, dos cards e dos workflows, subagentes incluídos.

> **Estimativa:** o valor é o equivalente em preços de API, estimado. Numa assinatura do Claude,
> nada disso é cobrado.

Os dólares seguem o idioma do app onde quer que um custo apareça: `US$ 1.234,50` em português,
`US$ 1,234.50` em inglês (#1332).

- **Fonte:** os transcripts do Claude Code em `~/.claude/projects`, os mesmos do histórico.
  - Cada mensagem conta uma vez, mesmo quando o transcript a repete em várias linhas.
  - No primeiro boot desta versão, o daemon lê em segundo plano os transcripts que já existem e
    continua respondendo enquanto isso.
- **Período:** hoje, 7 dias, 30 dias, mês atual ou um intervalo, sempre no fuso do host.
- **Dados de:** todos os hosts, um host ou um projeto. O grupo **Projetos** do menu lista os
  projetos do período, com o nome que têm no Início; a escolha é a mesma que o Início e as Sessões
  guardam (#126). Um alerta de orçamento ou um cartão do Início abre um projeto só naquela visita.
- **Filtros:** modelo e origem (terminal, app, card, workflow, subagent).
- **O que aparece:**
  - o custo estimado, os tokens e a economia do cache (quanto o cache read custou a menos do que
    o mesmo volume como input normal);
  - um gráfico por dia, empilhado por projeto (Tab chega ao gráfico, as setas andam pelos dias e
    cada dia diz o total numa dica ao passar o mouse ou ao receber o foco), e as quebras por
    projeto, modelo e origem;
  - as sessões mais caras, e clicar numa abre a sessão;
  - o custo estimado também aparece na lista de sessões, na sessão aberta, no card e na execução
    de workflow.
- **Exportar CSV:** salva, pelo diálogo do sistema, uma linha por dia, projeto, modelo e origem.
- **Avisos:**
  - modelos sem preço aparecem como "sem preço", com o nome;
  - nas sessões gerenciadas, o daemon compara o custo calculado com o que o próprio Claude Code
    informa, e se a diferença passa de 10% (e de US$ 0,05), a tela avisa que a tabela de preços
    pode estar desatualizada.
- **Retenção:** o uso fica `retention.usageDays` dias (padrão 400).
- **Ir para Custos** na [paleta](daily-use.md#paleta-ctrlk) aparece quando o app tem a tela de Custos e algum
  host anuncia `costs`.

## Preços

A tabela padrão é a de preços de API de 06/10/2026, em US$ por milhão de tokens:

| Modelo | Input | Output | Cache read |
| --- | --- | --- | --- |
| `claude-fable-5-1` | 10,00 | 50,00 | 0,25 |
| `claude-opus-5-5` | 4,00 | 20,00 | 0,20 |
| `claude-sonnet-5-5` | 2,00 | 10,00 | 0,20 |
| `claude-haiku-5-5` | 0,10 | 0,50 | 0,01 |

- **Escrita de cache:** 1,25× o input no cache de 5 minutos e 2× no de 1 hora, que é o que o
  Claude Code usa.
- **Haiku 5.5:** passa a 0,50 e 2,50 acima de 100 mil tokens de prompt.
- **Fast mode:** o do Opus 5.5 custa 2×.

Para sobrescrever, use `pricing` na config, modelo a modelo:

```json
{
  "pricing": {
    "models": {
      "claude-opus-5-5": { "input": 4, "output": 20, "cacheRead": 0.2 },
      "claude-haiku-5-5": {
        "input": 0.1, "output": 0.5, "cacheRead": 0.01,
        "tiers": [{ "abovePromptTokens": 100000, "input": 0.5, "output": 2.5 }]
      }
    },
    "cacheWrite5mMultiplier": 1.25,
    "cacheWrite1hMultiplier": 2,
    "fastMultiplier": { "claude-opus-5-5": 2 }
  }
}
```

- **O que muda:** um modelo na config substitui o padrão daquele modelo. Os modelos que não
  aparecem ficam com o padrão.
- **Recalcular:** o comando `costs.reprice` relê a config e recalcula o custo de todas as
  entradas. Não precisa reiniciar o daemon.

## Orçamentos

Em **Configurações**, cada host com custos tem a seção **Orçamentos**:

- **Configuração:** cada orçamento é do host ou de um projeto (a chave de projeto da tela
  Sessões), por dia ou por mês, no fuso do host, com um limite em US$.
- **O que conta:** o custo estimado de todas as origens. A lista mostra quanto já foi gasto no
  período e o percentual.
- **Alertas:** em 50%, 80% e 100%, uma vez por período cada, como notificação do sistema e na
  faixa "Precisa de você".
- **Ação:**
  - **notificar:** só os alertas;
  - **segurar cards novos:** em 100%, os cards novos daquele escopo esperam na fila com o
    motivo `budget`. Eles saem sozinhos no período seguinte ou quando o limite sobe.
  - Sessões do terminal e sessões manuais nunca são seguradas.
- **Medido em:** num host que informa a cota do plano (uma assinatura), também oferece uma parte da
  **janela de 5 horas** ou da **janela semanal**, em vez de dólares. O limite é um percentual da janela
  (de 0,1% a 100%) e a janela é o período: alertas e retenção recomeçam quando ela reinicia. Num
  projeto o uso é estimado pela parte dele no custo da janela (a lista marca **estimativa**). Sem
  leitura da janela o orçamento fica em zero. Um flightdeckd mais antigo só tem o formulário em dólares.

## Histórico da cota

Toda leitura da cota de uma sessão gerenciada fica guardada por 30 dias. Leituras iguais em menos
de 5 minutos viram uma só.

- **Na tela Custos:** a seção **Cota** mostra as janelas de 5 horas e de 7 dias ao longo do tempo.
- **Projeção:** com pelo menos 3 leituras da janela atual:
  - "no ritmo atual, a janela de 5 h esgota às HH:MM";
  - ou "não esgota antes de HH:MM", quando o ritmo não chega a 100% antes do reinício.
- **Tooltip:** as barras do topo da tela Sessões mostram a mesma projeção.
- **Quem consumiu a janela:** a fatia de cada projeto no custo estimado desde o início da janela
  de 5 horas atual. É uma atribuição aproximada, porque o plano não diz quem usou a cota.

## Retorno sobre o custo

Nos hosts que anunciam `roi`, a página do board do projeto começa com um cartão de **Retorno sobre o custo**, e a tela
de Custos ganha uma **tabela de projetos**, uma **tabela de pessoas** e um bloco de configurações. A primeira pergunta é
*entregamos mais pelo que custou?* Todos os números são correlacionados e estimados: horas e valores são digitados, não
medidos, e um card concluído não é um resultado verificado. As telas nunca falam em lucro nem em economia.

- **O cartão.** Começa dobrado numa só linha (o título, a primeira linha abaixo e **Detalhes**), então o
  board começa logo abaixo dele; **Detalhes** abre e a escolha é lembrada. Escolha 7 dias, 30 dias ou este mês. A primeira linha diz quantos itens foram entregues (cards
  concluídos, separados em *planejados*, que já estavam no board quando o período começou, e *não planejados*, criados e
  concluídos dentro dele), quanto os agentes custaram e se isso é mais, menos ou praticamente o mesmo (dentro de 5%) que
  no período anterior, com o custo por item dos dois. Abaixo: cards concluídos e PRs mesclados, custo por card e por PR,
  a linha de retrabalho (rodadas de conserto e o custo delas), horas e valor estimados marcados como estimativa e uma
  tendência de 8 semanas com texto alternativo. **Como isso é calculado?** lista cada número com as suas entradas.
- **Sinais opcionais.** No bloco **Horas e valor** do cartão, cada projeto pode ligar *commits de agentes* (commits do
  período com o trailer `Co-Authored-By: Claude`; aproximado, porque uma pessoa também pode pôr o trailer) e *issues
  fechadas* (perguntadas ao `gh` do host, guardadas por uma hora; o cartão diz quando o `gh` falta ou está sem login).
  Os dois vêm desligados.
- **A tabela de Custos.** Uma linha por projeto do escopo de clientes escolhido: custo, cards, PRs, custo por card e por
  PR, horas estimadas, valor estimado e retorno sobre o custo (estimativa). Clique no cabeçalho de uma coluna para
  ordenar, e de novo para inverter. O traço quer dizer que o número não pode ser calculado (sem cards, sem valor da
  hora). O rodapé soma as linhas. **Exportar a tabela de projetos em CSV** salva uma linha por projeto, com uma coluna
  que diz como cada número foi feito; o arquivo sempre usa ponto como separador decimal.
- **Pessoas.** *Tokens contra entrega, por pessoa* agrupa hosts numa pessoa com nome (por exemplo, o host em que os
  agentes de alguém rodam) com um limite mensal de tokens e/ou de custo. Mostra o uso do mês contra o limite, o que foi
  entregue e os tokens por card. As pessoas aparecem por nome: é uma visão, não um ranking, e hosts não são pessoas.
  Nada é imposto; quem para o trabalho continuam sendo os orçamentos de host e de cliente.

### Onde defino o valor da hora?

O valor da hora é um dado financeiro da pessoa e fica no app; os hosts nunca o veem. Vale o do próprio projeto, depois
o do cliente dele, depois o padrão.

- **Padrão e tempo de revisão:** Custos, **Configurações do retorno sobre o custo**. Ali também se escolhe se o *seu*
  tempo de revisão conta como custo (no máximo o limite que você define para cada decisão; desligado por padrão, e o
  cartão mostra o tempo de espera como informação de qualquer forma) e se cuidam das pessoas.
- **Um cliente:** a tela **Clientes**, **Valor da hora deste cliente**.
- **Um projeto:** o bloco **Horas e valor** do cartão na página do board, que também guarda as horas que cada card vale
  por padrão. As horas de um card só ficam no detalhe dele, **Horas estimadas deste card**.

### Por que um projeto não tem retorno sobre o custo?

- **Sem valor da hora:** o cartão diz *Defina o valor da hora para ver o valor estimado*; o custo por card e por PR
  continuam aparecendo.
- **Sem horas:** cards concluídos sem estimativa e sem padrão do projeto são contados e citados, e não somam horas.
- **Nada entregue:** o cartão diz isso e ainda mostra o que os agentes custaram.
- **Ainda sem custo:** a razão precisa de um custo maior que zero.
- **O host está offline ou não anuncia `roi`:** os números dele faltam; os outros continuam somando.

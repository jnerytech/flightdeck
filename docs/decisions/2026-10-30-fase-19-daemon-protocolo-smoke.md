# Decisões e divergências da Fase 19 (daemon, protocolo e smoke) (phase 19)

O que a spec da Fase 19 (regras de uso por segredo) deixou aberto, ou o que mudou na implementação. Nesta rodada entrou o lado do daemon: `regras-modelo`, `regras-padroes`, `regras-aprovacao`, `regras-auditoria` e o `smoke:rules-vault`. O editor de regras, a prévia na tela, o "Criar regra a partir disto", a bandeja e as notificações (`regras-ui`) esperam a Fase 10.

## Quem decide

- **A decisão final é do app**, que entrega o segredo (Fase 16). O daemon guarda uma cópia das regras de cada segredo **em memória** (`vault.rules.set`, que o app reenvia ao conectar) e decide o pedido do mesmo modo, por duas razões: o que nenhuma regra ou padrão deixa passar falha na hora, sem incomodar o app (e sem o app conectado), e o daemon **recusa a entrega** de um pedido que pergunta enquanto ele não foi aprovado (o gate). Depois de reiniciar, até o app reenviar as regras valem os padrões, que são os seguros.
- **O daemon não aprova nada sozinho:** `allow` e `ask` seguem para o app, com o veredito no frame; só o `deny` termina ali.
- **`decideRequest`** (em `vault/requests.ts`) concentra o resto do que a spec manda: o solicitante que o daemon não conhece, `you` inclusive, é negado antes de qualquer regra; um conhecido passa pelas regras do segredo e pelos padrões, com o teto e o risco alto aplicados. As regras e o teto vivem em `vault/rules.ts`, sem I/O, para o app e os testes usarem do mesmo jeito.

## Modelo

- **A primeira regra que casa vale**, mesmo que uma depois também case. Uma regra expirada (`expiresAt`) é pulada. Um campo de `match` que o uso não tem (sem ação, sem projeto, sem sessão) não casa.
- **Campos de `match`:** `requester`, `purpose` (`ssh`, `action`, `run_with_secret`), `action` (com `*`, sem tratar o resto como regex), `host` (o nome do host do daemon), `tags` (todas as listadas, sem ligar a caixa), `project` (a `projectKey`) e `session`. As tags de um uso são as da ação (campo novo `tags:` no schema das ações, que entra no que a confiança fixa) mais as do segredo (as que o app manda no `vault.rules.set`).
- **Janela:** dias e horas no fuso do PC (o do sistema, ou `timeZone` injetado nos testes). O fim é exclusivo, `24:00` vale como fim do dia, e uma janela com `from` depois de `to` passa da meia-noite: os dias listados são os do começo dela. Fora da janela vale o `outsideWindow`, `deny` por padrão.
- **Limites:** `maxPerHour` e `maxPerDay` contam, em janelas **móveis** de 60 minutos e 24 horas, os usos que a regra deixou passar (`allowed` ou `approved` no registro). O que o usuário negou, o que venceu e o que foi recusado não gasta o limite. Estourou, vira `deny` com aviso (`vault.alert`, tipo `limit`). A spec diz "até o período virar"; as janelas móveis foram a escolha mais simples de explicar.
- **`once: session` só com `ask`**, e a validação recusa as combinações sem sentido (`outsideWindow` sem `window`, `from` igual a `to`, id repetido, campo desconhecido). Com um erro, **nenhuma regra da lista é aceita** e as antigas ficam.

## Padrões e teto

- **Padrões** (a tabela da spec): você = `allow`; o Claude com uma ação declarada = `ask` uma vez por sessão, ajustado pelo `approval` que a ação declara (`never` libera, `always` pergunta a cada uso); `run_with_secret` = `ask` a cada uso; `automation` e `workflow` = `deny`; tag `prod` ou `produção` = `ask` a cada uso, com o botão segurado.
- **Teto, em dois lugares:** o `vault.rules.set` recusa a regra com `allow` para `run_with_secret` e com `allow` para prod sem `window`, explicando (inclusive pelo `outsideWindow: allow`); e o `evaluate` aplica o mesmo teto ao decidir, para uma regra sem `purpose` ou sem `tags` não furar: um `allow` num uso de `run_with_secret` vira `ask` a cada uso, e um `allow` em prod fora de uma janela que decidiu vira `ask` a cada uso.
- **Risco alto sobe para `ask`:** o classificador da Fase 13 olha a linha de comando do uso (o `run` da ação, ou o comando livre). Um `allow` ou um `ask` uma vez por sessão com risco `high` vira `ask` a cada uso, com o botão segurado. O uso por você não sofre o teto nem o risco, que protegem do Claude e dos automatismos.
- **Segurar o botão:** o pedido de prod ou de risco alto (`needsHold`) só aceita a aprovação com `heldMs` de pelo menos 2000 e **nunca vinda da bandeja**. O daemon confere os dois no `vault.approve`; é o app que mede o tempo.

## Aprovação

- **Fluxo:** o frame `vault.request` leva `decision`, `ruleId`, `reason`, `once`, `needsHold`, `tags` e `expiresAt`. O app responde com `vault.approve` (`via: app | tray`, `heldMs`, `scope: once | session`) e entrega pelo `vault.deliver`, ou com `vault.deny`. Um `vault.deliver` de um pedido que pergunta, sem aprovação, falha com `invalid_state`; as entregas que não são de um pedido do daemon (as do próprio usuário, as de outro propósito) passam como antes.
- **Aprovar para a sessão** só quando a regra permite (`once`): o pedido que pergunta a cada uso recusa. O que foi aprovado é lembrado **por segredo, regra e sessão**; o próximo uso na mesma sessão vira `allow` com o motivo "já aprovado nesta sessão".
- **A sessão** é o `session` que o cliente informa. O servidor MCP gera um por processo, e um `flightdeckd mcp` serve uma sessão do Claude Code. A ponte `flightdeckd action run` (o mod) não informa, então cada chamada dela vale como uma sessão: o "uma vez por sessão" vira "a cada uso" para quem usa o mod. Sem sessão, o aprovado para a sessão não é lembrado.
- **Vence em 10 minutos** (`REQUEST_TTL_MS`; era 2 minutos na Fase 17): o pedido sem resposta é negado, registrado como `expired`, e quem pediu recebe o erro "venceu sem resposta e foi negado". O frame diz até quando vale (`expiresAt`).
- **A Fase 17 continua valendo sem as regras:** um `Actions` sem o serviço de regras (os testes dela) pede ao app como antes. O daemon de verdade sempre as tem.

## Auditoria

- **`vault_decisions`:** uma linha por pedido do daemon, com a regra que decidiu, a decisão, quem deixou passar (`rule`, `app`, `tray` ou `session`), a janela da regra como estava, o motivo e como terminou (`pending`, `allowed`, `approved`, `denied`, `expired`, `refused` ou `failed`). Nunca leva um valor nem o comando. O `vault_usage` do app (Fase 16) é do app; esta é a parte do daemon.
- **Relatório:** `vault.report` agrupa por segredo, solicitante e resultado nos últimos 30 dias (ou `days`); com `format: csv` vem também o texto. A célula que começa com `=`, `+`, `-`, `@`, tab ou retorno ganha um `'` na frente, para a planilha não executá-la, e as com vírgula, aspas ou quebra de linha vão entre aspas.
- **Alerta:** a primeira vez que um solicitante pede um segredo gera um `vault.alert` (`new-requester`) mesmo quando a regra permite, e também quando o pedido é recusado. A spec fala também de "fora do padrão"; só a primeira vez entrou.
- **A prévia** (`vault.rules.preview`) dá o veredito de um uso hipotético, com a hora que o app quiser (`at`), sem gravar nada.

## Travas e testes

- **Correções de teste antes do `feat` (regra 8):** o `cofre-solicitante` (o padrão da automação agora nega).
- **Ramos revelados pela cobertura (regra 7):** o ambiente do sistema do `decideRequest`, e o daemon montado pelo `main` aplicando as regras (vermelho: o resolvedor da chave do projeto trocado por um que lança). A mutação mostrou o vermelho para o teto de `run_with_secret`, o de prod, o risco alto e a validação.
- **`smoke:rules-vault`:** foi escrito depois das áreas. O vermelho veio três vezes por mutação: tirando o gate da entrega (`a entrega antes da aprovação devia ter sido recusada`), deixando a janela sempre aberta (`fora da janela devia ser negado`) e não reconhecendo prod (`o pedido de prod devia perguntar, segurando o botão`). O `smoke:actions` passou a aprovar o que pergunta antes de entregar.
- **Migração:** uma, no fim (`vault_decisions`). Nenhum teste fixa o índice dela.
- **Áreas do app que esperam a Fase 10:** `regras-ui`, o "Criar regra a partir disto", as notificações e a bandeja (que não aprova prod).

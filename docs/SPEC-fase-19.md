# Flightdeck — Spec da Fase 19 (Regras de uso por segredo)

## Objetivo e escopo

Decidir, por segredo e por ambiente, **quem pode usar o quê e com que aprovação**. Por exemplo:
- "o Claude pode usar a chave de staging sozinho";
- "a de produção, só com a minha aprovação e fora das 18h às 8h nunca";
- "automações nunca usam o token do cliente X".

Pré-requisitos: Fases 16 (cofre) e 17 (ações). Usa o risco e a aprovação da Fase 13 e a bandeja da Fase 8.

**Fora da Fase 19**

- Regras para várias pessoas ou papéis: o produto é de um usuário só.
- Aprovação por um segundo aparelho. Fica para uma versão futura.

## Modelo

- **Regra:** cada segredo tem uma lista ordenada de regras, e a primeira que casa vale. Sem regra que case, vale a regra padrão do tipo de segredo.
  ```yaml
  - match: { requester: claude, purpose: action, action: "deploy-staging" }
    decision: allow
  - match: { requester: claude, tags: [prod] }
    decision: ask
    window: { days: [mon, tue, wed, thu, fri], from: "08:00", to: "18:00" }
    outsideWindow: deny
  - match: { requester: automation }
    decision: deny
  ```
- **O solicitante nunca vem do daemon:** `you` só vale para usos que o app iniciou. Um pedido vindo do daemon é sempre `claude`, `automation` ou `workflow`, e um ausente ou desconhecido é o mais restrito (Fase 16).
- **Campos de `match`** (todos opcionais, combinados com E):
  - `requester`: `you`, que é você no app; `claude`, uma sessão pelo MCP ou pelo mod; `automation`, da Fase 13; `workflow`, da Fase 6;
  - `purpose`: `ssh`, `action` ou `run_with_secret`;
  - `action`: o nome da ação, com curinga `*`;
  - `host`: o host do Flightdeck que roda o uso;
  - `tags`: as do destino SSH ou da ação;
  - `project`: a `projectKey`;
  - `session`: uma sessão específica, para regras temporárias.
- **Decisões:**
  - `allow`, sem perguntar;
  - `ask`, que pede aprovação a cada uso, ou uma vez por sessão com `once: session`;
  - `deny`.

  `window` restringe a decisão a dias e horas no fuso do PC. Fora da janela vale `outsideWindow`, que por padrão é `deny`.
- **Limites:** `maxPerHour` e `maxPerDay` por regra. Estourou, vira `deny` até o período virar, com aviso.
- **Expiração:** `expiresAt` deixa uma regra temporária, por exemplo "libera o Claude a usar a chave de prod até as 17h de hoje".

## Padrões seguros

| Tipo ou caso | Padrão sem regra |
| --- | --- |
| uso por você no app | `allow` |
| `claude` com uma ação declarada e confiada | `ask`, uma vez por sessão |
| `claude` com `run_with_secret` | `ask` a cada uso (a Fase 17 já exige, e nenhuma regra pode mudar isso para `allow`) |
| `automation` e `workflow` | `deny` |
| destino ou ação com tag `prod` ou `produção` | `ask` a cada uso, para qualquer solicitante que não seja você |

- **Teto:** uma regra pode afrouxar um padrão, por exemplo deixar o Claude rodar o `deploy-staging` sem perguntar. Duas coisas nunca são permitidas:
  - `allow` para `run_with_secret`;
  - `allow` para `prod` sem `window`.

  O app recusa salvar essas regras e explica por quê.
- **Risco (Fase 13):** um uso que o classificador marca como `high` sobe para `ask` mesmo com uma regra `allow`.

## Aprovação

- **Pedido:** chega em "Precisa de você", com notificação e na bandeja, mostrando segredo, solicitante, finalidade, a ação e os parâmetros (ou o comando), o host e a regra que decidiu.
- **Respostas:**
  - Aprovar;
  - Aprovar e não perguntar mais nesta sessão, quando a regra permite;
  - Negar;
  - **"Criar regra a partir disto"**, que abre o editor já preenchido.
- **`prod`:** um pedido com tag `prod` exige segurar o botão Aprovar por 2 s, como o risco `high` da Fase 13. A bandeja não aprova esses pedidos.
- **Sem resposta:** o pedido vence em 10 min e é negado, com aviso ao solicitante.

## Auditoria

- **Registro:** o `vault_usage` da Fase 16 ganha a regra que decidiu, a decisão, quem aprovou e a janela.
- **"Relatório do cofre":** usos por segredo, solicitante e decisão nos últimos 30 dias, com exportação em CSV.
- **Alerta:** um segredo usado por um solicitante novo, ou fora do padrão (por exemplo, a primeira vez de uma automação), dispara um aviso no app, mesmo quando a regra permite.

## Protocolo e plataforma

- As regras são do app, junto com o cofre.
- A decisão acontece no app, que é quem entrega o segredo (Fase 16). Por isso, nenhum daemon pode decidir sozinho.

## Testes e critérios

| Área | O que precisa passar |
| --- | --- |
| `regras-modelo` | primeira que casa; cada campo de `match`; `window` no fuso injetado; `outsideWindow`; `maxPerHour` e `maxPerDay`; `expiresAt` |
| `regras-padroes` | os padrões da tabela; o teto recusa `allow` para `run_with_secret` e para `prod` sem janela; risco `high` sobe para `ask` |
| `regras-aprovacao` | pedido com regra que decidiu; aprovar, aprovar na sessão, negar e criar regra; `prod` com segurar 2 s; bandeja sem `prod`; vence em 10 min |
| `regras-auditoria` | registro com regra, decisão e aprovador; relatório e CSV; alerta de solicitante novo |
| `regras-ui` | editor de regras por segredo com ordem arrastável, prévia "o que acontece se…" e explicação de recusa do teto |

**Smoke (`bun run smoke:rules-vault`)**

- O Claude falso chama `deploy-staging`, com uma regra `allow`, e a ação roda.
- Chama `logs-prod`, que fica em `ask`. Fora da janela, é negado. Dentro, é aprovado pelo protocolo.
- Uma automação é negada pelo padrão.
- Imprime `SMOKE RULES-VAULT OK`.

**Critérios de aceite:**
- [ ] Os de sempre: TDD por área, auditoria, cobertura de 100%, todos os smokes, builds, CI verde, prints, versões em `0.19.0`, README e DECISIONS.
- [ ] Conferência com o claude real: numa sessão de verdade, uma regra `allow` para staging roda sem pergunta, e `prod` pede aprovação no app.

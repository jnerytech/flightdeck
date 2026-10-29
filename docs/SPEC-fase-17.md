# Flightdeck — Spec da Fase 17 (O Claude usa o segredo sem vê-lo)

## Objetivo e escopo

O usuário quer que o Claude faça deploy, consulte um servidor ou chame uma API **sem colar senha ou token no chat**. A Fase 17 faz o Claude usar um segredo do cofre (Fase 16) **sem nunca recebê-lo**:
- o Flightdeck aplica o segredo do lado dele;
- o Claude recebe só o resultado, com o segredo mascarado.

Pré-requisitos: Fase 16 (cofre). As ações por SSH usam a Fase 15.

**Fora da Fase 17**

- Dar ao Claude um comando arbitrário com o segredo no ambiente sem aprovação. O caminho livre existe, mas sempre pede a sua aprovação (abaixo).
- Fluxos de OAuth em nome do usuário.

## Ações: o jeito seguro

Uma **ação** é um comando declarado por você, com lugares marcados para segredos e para parâmetros. O Claude chama a ação pelo nome e só escolhe os parâmetros que você permitiu.

- **Onde mora:** a ação pertence ao projeto ou ao host, guardada pelo daemon do host em que roda:
  ```yaml
  # Projeto → Ações, ou .flightdeck/actions.yaml (versionado, sem segredos)
  - name: deploy-staging
    description: Faz o deploy da branch na VPS de staging
    host: vps
    run: ["./scripts/deploy.sh", "{{param.branch}}"]
    cwd: /srv/app
    env:
      DEPLOY_TOKEN: "{{secret.deploy-token-staging}}"
    params:
      branch: { pattern: "^[a-zA-Z0-9._/-]{1,80}$", default: main }
    timeoutS: 600
  - name: logs-prod
    description: Últimas linhas do log da API em produção
    ssh: prod-api
    run: ["journalctl", "-u", "api", "-n", "{{param.lines}}", "--no-pager"]
    params:
      lines: { pattern: "^[0-9]{1,4}$", default: "200" }
  ```
- **Execução:**
  - `run` é uma lista de argumentos e nunca passa por shell;
  - um segredo só entra em `env` ou como arquivo temporário (`{{secretFile.x}}`, apagado depois), **nunca como argumento**, porque argumento aparece na lista de processos;
  - cada parâmetro precisa casar com o `pattern` dele;
  - `ssh:` roda pelo destino SSH da Fase 15, com `ssh <destino> -- <argv>` e o ambiente enviado por `SendEnv` ou por stdin.
- **Ações versionadas:** as ações de um `.flightdeck/actions.yaml` versionado só rodam depois de **confiadas**, pelo hash, como os workflows da Fase 6. As ações criadas pelo app ficam no daemon e não precisam disso.

## Como o Claude chama

- **MCP do Flightdeck (Fase 6):** ganha duas ferramentas:
  - `list_actions`: nome, descrição e parâmetros com padrão e default, **sem segredos**;
  - `run_action { name, params }`: devolve o código de saída e a saída, até 32 KB, com o segredo mascarado.
- **Mod do Claude Code `flightdeck-actions`**, para sessões do terminal sem o MCP configurado:
  - registra as mesmas duas ferramentas, falando com o daemon local pelo protocolo;
  - traz uma faixa "ação rodando: deploy-staging" e o comando `/flightdeck-actions`, que lista as ações;
  - fica em `mods/flightdeck-actions` no repositório, instalável com `/plugin install`.

## Máscara

- **Antes de devolver ao Claude:** o daemon troca, na saída, cada ocorrência literal de cada valor entregue por `•••(nome do segredo)`, inclusive as linhas de cada valor com várias linhas.
- **Formas codificadas comuns:** também mascara o valor em base64, em URL-encode e em hex.
- **Limite:** um segredo transformado de outro jeito não é pego, e a documentação diz isso. Por isso o caminho seguro é a ação declarada, e não o comando livre.
- **Onde vale:** a mesma máscara vale para a aba de terminal quando uma ação roda nela, e para os registros de uso.

## Comando livre com segredo (sempre com aprovação)

- **Ferramenta `run_with_secret { command, secrets, host }`:** um comando escrito pelo próprio Claude, com segredos no ambiente.
  - **Sempre** pede a sua aprovação, com o comando, os nomes dos segredos e o host. Nunca é automático, nem com a aprovação por IA da Fase 13.
  - A aprovação vale para aquela execução.
  - Rodar com `{"type":"addRules"}` não se aplica: não existe "permitir sempre" aqui.

## Aprovação das ações

- Uma ação pode exigir aprovação: `approval: always | never | first-per-session`.
- O padrão é `first-per-session` para ações com segredo e `never` para as sem segredo.
- As regras finas por segredo e por ambiente são da Fase 19.

## Protocolo (só adições)

| Item | Tipo | Conteúdo |
| --- | --- | --- |
| `actions.list` / `actions.save` / `actions.remove` / `actions.trust` | comando | ações do projeto e do host; `trust` pelo hash, para as versionadas |
| `actions.run` | comando | `{ name, params, requestedBy }`; o daemon pede os segredos ao app (`vault.request`) e devolve a saída mascarada |
| `actions.runs` | comando | histórico com código, duração, quem pediu e saída mascarada |

## Testes e critérios

| Área | O que precisa passar |
| --- | --- |
| `acoes-schema` | YAML válido carrega; `run` não lista é erro; segredo em argumento é erro; parâmetro sem `pattern` é erro; referência a segredo inexistente é erro |
| `acoes-execucao` | argv sem shell; segredo só em env ou em arquivo temporário apagado; parâmetro fora do `pattern` recusado; timeout; `ssh:` monta pelo destino |
| `acoes-confianca` | arquivo versionado não roda sem confiar; hash diferente pede de novo |
| `mascara` | valor literal, de várias linhas, em base64, em URL e em hex mascarado na saída, no terminal e nos registros |
| `mcp-acoes` | `list_actions` sem segredos; `run_action` com parâmetros válidos e saída mascarada; `run_with_secret` sempre pede aprovação e nunca é auto-aprovado |
| `mod-acoes` | o mod registra as ferramentas e fala com o daemon (teste do kit de mods); faixa e comando |
| `acoes-ui` | tela de ações por projeto e host com seletor de segredo e parâmetros; histórico com saída mascarada; confiar ação versionada |

**Smoke (`bun run smoke:actions`)**

- Uma ação de eco imprime o próprio token. O Claude falso a chama pelo MCP e recebe `•••(nome)` no lugar do valor.
- Uma ação com parâmetro inválido é recusada.
- Um `run_with_secret` sem aprovação não roda.
- Imprime `SMOKE ACTIONS OK`.

**Critérios de aceite:**
- [ ] Os de sempre: TDD por área, auditoria, cobertura de 100%, todos os smokes, builds, CI verde, prints, versões em `0.17.0`, README e DECISIONS.
- [ ] `claude plugin validate` e `claude plugin test` passam no mod `flightdeck-actions`.
- [ ] Conferência com o claude real: numa sessão de verdade, o Claude faz um deploy de teste por uma ação e o transcript não contém o segredo. O orquestrador confere procurando o valor no `.jsonl`.

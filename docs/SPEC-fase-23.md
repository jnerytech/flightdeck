# Flightdeck — Spec da Fase 23 (Telemetria das sessões do terminal)

## Objetivo

O Claude Code já emite telemetria OpenTelemetry (OTLP): eventos de ferramenta com duração, requisições de API com custo e tokens, erros de API e decisões de permissão, agrupados por prompt. Hoje isso só aparece em Grafana, Elastic ou Axiom. A fase faz o **daemon receber esse OTLP localmente**, para mostrar **custo, tempo e gargalos exatos também das sessões abertas no terminal**: ferramenta lenta, espera de permissão e erro de API.

Origem: pesquisa de 30/10/2026, com guias da Axiom e da Last9, e o painel de custo do opcode. Pré-requisitos: Fases 5 (wrapper e hooks) e 8 (custos).

## Desenho

- **Receptor OTLP/HTTP** no daemon, em `127.0.0.1:<hooks.port + 1>`, com JSON e protobuf. Só loopback, e um token próprio no cabeçalho.
- **Ligar:**
  - o `flightdeckd claude` injeta as variáveis no claude que abre: `CLAUDE_CODE_ENABLE_TELEMETRY=1`, os exportadores OTLP de métricas e de logs, o endpoint, o cabeçalho com o token e intervalos curtos;
  - para o `claude` puro, existe a opção de gravar as mesmas variáveis no `env` do `~/.claude/settings.json`. É opt-in, com confirmação, como os hooks da Fase 5, e com uninstall.
  - **Prompts, parâmetros de ferramenta e corpos de API ficam desligados**, como é o padrão do Claude Code. O Flightdeck nunca liga o `OTEL_LOG_USER_PROMPTS` nem as variáveis equivalentes.
- **Prova de conceito:** os nomes exatos das variáveis, eventos e métricas na versão instalada vêm de uma prova de conceito do orquestrador ou da sessão, com o claude real e um `-p` curto, antes da implementação. A doc oficial vale contra os guias.
- **Dados:**
  - `telemetry_events` (sessão, prompt, tipo, ferramenta, duração, custo, tokens, erro e hora), com retenção de 30 dias;
  - ligados à sessão pelo `session.id` do evento;
  - o custo da telemetria **confere** o custo calculado pelos transcripts (Fase 8), e uma divergência aparece no `costs.status`.
- **No app:**
  - na sessão, uma aba "Tempo", com a linha do tempo dos prompts e, em cada um, as ferramentas com duração, a espera de permissão e os erros de API;
  - em Custos, o "tempo de espera por permissão" e as "ferramentas mais lentas" por projeto.

## Testes e critérios

| Área | O que precisa passar |
| --- | --- |
| `otlp-receptor` | JSON e protobuf; só loopback; token; corpo grande recusado |
| `otlp-ligar` | o wrapper injeta as variáveis sem as de conteúdo; o settings opt-in com backup e uninstall |
| `telemetria-dados` | os eventos se ligam à sessão e ao prompt; retenção; conferência com o custo dos transcripts |
| `tempo-ui` | aba Tempo; espera de permissão; ferramentas lentas em Custos |

**Smoke (`smoke:otel`):** o claude falso emite OTLP de exemplo, e a aba e os totais conferem.

**Critérios de aceite:** os de sempre, a versão `0.23.0` e a conferência com o claude real (uma sessão pelo wrapper com a aba Tempo preenchida).

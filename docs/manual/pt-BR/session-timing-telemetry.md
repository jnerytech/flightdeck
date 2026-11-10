# Tempo das sessões (telemetria)

[Voltar ao manual](../pt-BR.md) · [English](../en/session-timing-telemetry.md)

O Claude Code pode exportar OpenTelemetry (OTLP). O daemon recebe isso nesta máquina e usa para
mostrar o **tempo**, o **custo** e os **gargalos** das sessões abertas no terminal: uma ferramenta
lenta, o tempo que o Claude esperou você responder uma permissão, um erro de API.

- **Onde escuta:** só em `127.0.0.1`, na `telemetry.port` (`hooks.port + 1` quando ausente), com um
  token próprio que não é o dos hooks nem o do app. Pedido sem o token é recusado, e corpo acima de
  1 MiB também. Só escuta com a telemetria ligada (`telemetry.enabled`, ligada por padrão) **e** os
  hooks instalados; um daemon sem eles não abre porta extra. Se a porta estiver ocupada, o daemon
  registra e segue sem o receptor.
- **Ligar numa sessão:**
  - o `flightdeckd claude` dá ao claude que abre as variáveis do exportador
    (`CLAUDE_CODE_ENABLE_TELEMETRY`, os exportadores OTLP de métricas e logs, o endereço, o
    cabeçalho com o token e intervalos curtos). Não acrescenta nada sobre um exportador que você
    já configurou, nem no modo de impressão (`-p`).
  - Para um `claude` puro, use **Instalar telemetria** no painel **Telemetria** da página do host (ele pergunta antes, dizendo o arquivo e a cópia), ou rode `flightdeckd telemetry install`: ele grava as mesmas oito chaves em
    `env` do `~/.claude/settings.json`, depois de uma cópia em
    `settings.json.flightdeck-telemetry-backup`. Se alguma dessas chaves já tem um valor seu, ele
    para, diz quais e não muda nada. `flightdeckd telemetry status` diz `installed`, `absent`,
    `outdated` ou que há um exportador seu; `flightdeckd telemetry uninstall` (ou **Remover telemetria**) tira só as chaves do
    Flightdeck e **troca o token**, e uma cópia do antigo deixa de valer.
- **O que fica guardado:** de cada evento, a sessão, o prompt, a hora, quanto demorou, o custo, os
  tokens, se uma ferramenta funcionou, o tipo do erro ou o status HTTP e quem respondeu uma
  permissão. **Prompts, respostas, parâmetros de ferramentas e corpos de API nunca são coletados.**
  O Flightdeck nunca liga uma variável `OTEL_LOG_*`, e se um exportador mandar esse texto mesmo
  assim, ele é descartado na chegada. Os eventos ficam 30 dias (`telemetry.retentionDays`).
- **A aba Tempo:** numa sessão com dados, **Tempo** lista cada prompt com seus passos em ordem: os
  pedidos à API, as ferramentas com o tempo (uma barra compara cada uma com o passo mais longo do
  prompt), as permissões e quanto você deixou o Claude esperando, e os erros de API. A espera é uma
  estimativa: o intervalo entre o passo anterior e a sua resposta.
- **Em Custos:** **Tempo por projeto** mostra, por projeto, o tempo esperando permissões e as
  ferramentas mais lentas (média, máximo, chamadas). Um aviso aparece quando o custo de uma sessão
  na telemetria está longe (mais de 10% e US$ 0,05) do calculado pelos transcripts, no trecho da
  sessão em que o exportador estava ligado.
- **Limites:** só sessões que mandaram telemetria têm dados; as métricas que o exportador manda são
  aceitas e não guardadas. Para quem desenvolve, `bun run smoke:otel` roda o caminho todo com um
  claude falso.

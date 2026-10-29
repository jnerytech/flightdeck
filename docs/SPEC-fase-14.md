# Flightdeck — Spec da Fase 14 (Espaço de trabalho: abas e terminal embutido)

## Objetivo e escopo

O usuário trabalha no terminal e quer o controle centralizado do app. A Fase 14 junta os dois:

- **Abas**, como num navegador: sessões, cards, diffs, terminais e leitores abertos lado a lado, com tela dividida.
- **Terminal embutido em qualquer host**: Windows, WSL, Orange Pi ou VPS. O daemon abre um terminal real no host e o app o mostra numa aba, sem SSH.
- **"Claude aqui"**: uma aba de terminal que já abre o `flightdeckd claude` na pasta. A sessão nasce na central, controlável, e aprovável pelo app.

Pré-requisito: Fase 10 (Interface) integrada. A fase usa a rota tipada, o shadcn/ui, o i18n e o tema dela. Pode ser desenvolvida em paralelo às Fases 11 a 13 e é rebaseada sobre a fase anterior integrada antes de fechar.

**Fora da Fase 14**

- Várias janelas do app. As abas vivem numa janela.
- Compartilhar terminal com outra pessoa, ou gravar e reproduzir sessões de terminal.
- Editor de código nas abas, além do editor pontual da Fase 11.

## Fatos levantados pelo orquestrador (29/10/2026)

- **PTY no Bun:** o Bun 1.4.4 tem PTY embutido, em `Bun.spawn(argv, { terminal: { cols, rows, data, exit, drain } })` e `new Bun.Terminal(...)`. Os tipos dizem "only POSIX", mas o teste no Windows do usuário funcionou: o `cmd.exe` rodou dentro de um PTY real (ConPTY) e devolveu a saída de um `echo`.
- **Resultado:** o daemon abre terminais nos três sistemas sem módulo nativo, e o binário compilado com `bun build --compile` continua um arquivo só.
- **Conferência no fechamento:** `resize` e o redesenho de programas de tela cheia no Windows, como o próprio `claude` e o `vim`.

## Abas

- **Modelo:** cada aba é uma rota da Fase 10 (`Route`) com o próprio histórico de voltar e avançar. A janela tem uma ou duas áreas, com a tela dividida na vertical ou na horizontal e o divisor arrastável, e cada área tem a sua barra de abas.
- **Abrir:**
  - Ctrl+clique ou clique do meio abre o item numa aba nova;
  - o menu de cada item tem "Abrir em nova aba";
  - o clique normal troca o conteúdo da aba atual, como hoje.
- **Barra de abas:**
  - ícone do tipo (sessão, card, diff, terminal, leitor, Custos) e o título;
  - selos: "precisa de você" em destaque, rodando, e não lida depois de uma resposta nova;
  - fixar (a aba fica só com o ícone, à esquerda) e fechar;
  - reordenar arrastando, ou pelo teclado (Ctrl+Shift+PageUp/PageDown);
  - mover para a outra área.
- **Atalhos:**

  | Atalho | Ação |
  | --- | --- |
  | Ctrl+T | aba nova, que abre na paleta (Fase 8) |
  | Ctrl+W | fecha a aba |
  | Ctrl+Shift+T | reabre a última fechada (pilha de 20) |
  | Ctrl+Tab / Ctrl+Shift+Tab | próxima e anterior |
  | Ctrl+1…9 | vai para a aba de número N |
  | Ctrl+\ | divide a tela ou junta as áreas |

- **Persistência:** as abas, a divisão e a aba ativa ficam guardadas no app e voltam ao reabrir. Uma aba de um host offline volta com o estado "Conectando a <host>…", e não some.
- **Fechar uma aba de terminal:** pergunta se encerra o processo ou só desanexa. O padrão é desanexar, e o terminal continua no host.

## Terminal embutido

### Daemon

- **Abrir:** `terminal.open { cwd, command?, cols, rows }` abre um PTY com `Bun.spawn` e devolve `{ terminalId }`.
  - O `cwd` passa pelo `resolveAllowedCwd` (allowedRoots).
  - Sem `command`, abre o shell padrão do host:
    - Windows: o `pwsh` se existir, senão o `powershell`;
    - Linux: o `$SHELL`, senão o `bash`, senão o `sh`.
- **Comandos:**
  - `terminal.write { terminalId, data }`: entrada do teclado, em UTF-8;
  - `terminal.resize { terminalId, cols, rows }`;
  - `terminal.attach { terminalId }`: devolve o scrollback e passa a receber `terminal.data`;
  - `terminal.detach`;
  - `terminal.close { terminalId, kill: boolean }`;
  - `terminal.list`: os terminais vivos do host, com cwd, comando, início e quantos apps estão anexados.
- **Frames:**
  - `terminal.data { terminalId, data }`: base64, em lotes de até 16 KB a cada 16 ms;
  - `terminal.exited { terminalId, exitCode }`.
- **Vida do terminal:**
  - o terminal **sobrevive à desconexão do app**;
  - o scrollback fica num buffer circular de 2 MB por terminal, que a reconexão reapresenta;
  - um terminal sem ninguém anexado é encerrado depois de `terminal.idleMinutes`, padrão 120;
  - o processo que termina sozinho manda `terminal.exited`.
- **Limites e contrapressão:**
  - `terminal.max`, padrão 10 por host;
  - quando o WebSocket de um cliente acumula mais de 1 MB, a leitura do PTY pausa (`drain`) até esvaziar.
- **Segurança:**
  - um terminal é um shell completo no host, como as sessões já são;
  - **liga por host:** `terminal.enabled` vale `true` quando o daemon só escuta em loopback e `false` quando aceita outras redes, como a Tailscale. Ligar num host remoto exige mudar a config, ou o botão da página do host, que pede confirmação;
  - o daemon registra abrir, anexar e encerrar no log de eventos, **sem o conteúdo**;
  - o conteúdo do terminal nunca vai para o banco.
- **Feature:** o `host.info` ganha a feature `terminal` (Fase 7), presente só quando a opção está ligada.

### "Claude aqui"

- **Onde aparece:** no menu de uma pasta, de um projeto ou de um card, e na paleta: "Abrir Claude aqui (terminal)".
- **O que faz:** abre um terminal com `flightdeckd claude` no cwd, com o `FLIGHTDECK_CONFIG` do daemon.
  - A sessão nasce controlável na central (Fase 5), e o app aprova e manda mensagens por ela.
  - Num card, o cwd é a worktree dele.
- **Na aba:** a aba do terminal ganha o botão "Ver como sessão", que abre a sessão da central ligada a ela pelo `launch_id`, e a sessão ganha "Ver terminal". As duas vistas são do mesmo Claude.
- **Retomar:** "Continuar no terminal", no leitor e nas sessões encerradas, abre `flightdeckd claude --resume <id>` numa aba de terminal. Substitui o "Abrir no terminal" externo da Fase 8, que continua no menu como "Abrir no Windows Terminal".

### App

- **Renderização:** `@xterm/xterm`, com os addons `fit`, `web-links`, `search` e `unicode11`, em versões fixas, e as cores dos tokens do tema (claro e escuro).
- **Teclado:**
  - copiar e colar com Ctrl+Shift+C/V e com o menu de contexto;
  - Ctrl+C vai para o processo;
  - buscar com Ctrl+Shift+F.
- **Fonte:** monoespaçada do sistema (Cascadia Mono, Consolas ou monospace), com tamanho nas Configurações.
- **Redimensionar:** ao mudar o tamanho da aba, a área manda `terminal.resize` com debounce de 100 ms.
- **Estado:** um terminal desanexado ou encerrado mostra o estado e oferece "Reabrir".

## Protocolo (só adições)

| Item | Tipo | Conteúdo |
| --- | --- | --- |
| `terminal.open` / `terminal.write` / `terminal.resize` / `terminal.attach` / `terminal.detach` / `terminal.close` / `terminal.list` | comando | como acima |
| `terminal.data` / `terminal.exited` | frame de topo | saída e fim |
| `host.info` | comando | `features` ganha `terminal`; `terminal: { enabled, max, shell }` |

## Disciplina TDD

Segue [`docs/TDD.md`](TDD.md).

**Travas:**
- Um PTY falso é injetado: um script de eco que responde às linhas e ao tamanho. Os testes unitários nunca abrem um shell real.
- O `smoke:terminal` é a única exceção, e usa um comando inofensivo fixo, o próprio `bun` imprimindo uma linha.
- As travas de CLIs e do claude continuam valendo: o "Claude aqui" é testado com o claude falso da Fase 5.

## Testes e critérios

| Área | O que precisa passar |
| --- | --- |
| `abas` | abrir em nova aba (Ctrl+clique, clique do meio, menu); trocar o conteúdo da aba atual; histórico por aba; fixar, fechar, reordenar com mouse e teclado; pilha de reabrir; atalhos; selos de estado |
| `divisao` | duas áreas na vertical e na horizontal; divisor arrastável; mover aba entre áreas; Ctrl+\ |
| `persistencia-abas` | abas, divisão e ativa voltam ao reabrir; aba de host offline volta "Conectando…" |
| `terminal-daemon` | `open` com o shell padrão por sistema (PTY falso); `cwd` fora de allowedRoots recusado; `write`, `resize` e `attach` com scrollback; o terminal sobrevive à desconexão; idle sem anexo encerra; `max`; contrapressão pausa e retoma; `close` com e sem `kill`; `exited`; log sem conteúdo |
| `terminal-seguranca` | `enabled` falso por padrão com bind fora de loopback; ligar pede confirmação; sem a feature, o app não mostra o terminal; comandos recusados com o terminal desligado |
| `claude-aqui` | abre o `flightdeckd claude` com o claude falso; a sessão nasce controlável e ligada à aba pelo `launch_id`; "Ver como sessão" e "Ver terminal"; "Continuar no terminal" com `--resume` |
| `terminal-ui` | xterm com o tema; copiar e colar; busca; resize com debounce; estados de desanexado e encerrado com "Reabrir"; fechar aba pergunta se desanexa ou encerra |
| `e2e-abas-terminal` | no Chromium, contra o demo: abrir duas abas, dividir, abrir um terminal, digitar `echo` e ver a saída, desanexar e reanexar com o scrollback |

**Smoke (`bun run smoke:terminal`)**

- Daemon `--runtime fake`, com `terminal.enabled`.
- Abre um terminal real com um comando fixo e inofensivo, lê a saída e manda um resize.
- Desconecta o cliente, reconecta, faz `attach` e recebe o scrollback.
- Encerra com `kill`.
- Imprime `SMOKE TERMINAL OK`.

**Critérios de aceite**

- [ ] O vermelho por asserção de cada área mostrado antes da implementação.
- [ ] `tdd:audit` OK desde o commit-base.
- [ ] typecheck, lint e test com cobertura de 100%.
- [ ] Todos os smokes, inclusive o `smoke:terminal`, no Windows e no Linux.
- [ ] Os builds e o `cargo check` passam.
- [ ] CI verde.
- [ ] Prints das abas, da divisão e do terminal nos dois temas e nos dois idiomas.
- [ ] Versões em `0.14.0`.
- [ ] README atualizado.
- [ ] `docs/DECISIONS.md` atualizado e git limpo.
- [ ] O orquestrador fecha a fase com uma conferência real no app instalado, com o usuário:
  1. terminal do Windows, com `claude` em tela cheia e resize;
  2. terminal do WSL;
  3. "Claude aqui" com aprovação pelo app;
  4. fechar e reabrir o app com os terminais vivos.

  Depois disso, cria a tag `fase-14`.

# Phase 14 decisions: the daemon (embedded terminal) (phase 14)

## Terminal embutido (daemon)

- **Backpressure vira `terminal.resync`:** a spec dizia "pausar a leitura do PTY" quando o cliente não acompanha. O Bun não tem pausa de leitura (o `drain` do `terminal` é do lado da escrita), então a leitura nunca para.
  - O anel de 2 MB é a fonte da verdade do que o terminal já mostrou.
  - Cada conexão que segue o terminal tem uma fila de até 1 MB. Se a fila estoura, ou o socket já tem mais de 1 MB parado, a fila é descartada e a conexão recebe `terminal.resync { terminalId }`. Dali em diante ela não recebe mais nada até um novo `terminal.attach`, que devolve o scrollback para continuar.
  - Um cliente lento custa só a própria fila: não segura o processo nem os outros clientes. Há um teste do cliente lento levando ao `resync` e outro mostrando que o PTY segue lido.
- **Fila segurada, sem evento de `drain`:** os dados saem em frames base64 de até 16 KB a cada 16 ms. Quando o socket está cheio, a fila é consultada de novo a cada 16 ms. O evento `drain` não é usado porque não dá para cobri-lo de forma determinística.
- **Código de saída vem de `proc.exited`:** o `exit` do `terminal` do Bun só avisa que a saída fechou. O `bunPty` espera os dois (o fim do fluxo e o `proc.exited`, com 100 ms de tolerância) antes de dar `terminal.exited`, para a última saída chegar antes do fim.
- **`kill` derruba os filhos:** testado no Windows (ConPTY) e no Linux: o processo e o filho que ele abriu somem. O `kill()` devolve 143, como um SIGTERM.
- **Redimensionar:** no ConPTY o resize redesenha a tela, mas o `stdout.columns` do filho não muda. Por isso o smoke só confere o ack e que a saída continua; o tamanho é conferido com o PTY falso.
- **`command` é um argv:** nunca passa por um shell. Sem `command`, o shell padrão do host (no Windows `pwsh`, depois `powershell`; nos outros `$SHELL`, depois `bash`, depois `sh`). O log nunca tem o conteúdo nem os argumentos, só o programa.
- **Ambiente dos terminais:** o mesmo `buildChildEnv` das sessões gerenciadas: `ANTHROPIC_API_KEY` sai, a menos que `allowApiKey` esteja ligado.
- **Desligado fora do loopback:** `terminal.enabled` da config manda. Sem ele, o terminal vem ligado quando o daemon só escuta em loopback e desligado quando aceita outras redes (um terminal é um shell completo no host).
  - Terminal desligado recusa todo comando `terminal.*` com `terminal_disabled`, e `host.info` não anuncia a feature. A desconexão de um cliente nunca falha.
  - `terminal.settings` liga e desliga em tempo de execução e grava na config. Ligar pede `confirm: true`; desligar não pede e encerra os terminais vivos.
  - Ligar e desligar vão para o log.
- **Opção `terminals`:** a Fase 8 já tem `terminal` no `ServerOptions` e no `main.ts` (o botão "abrir no terminal" do `host.info`). O gerenciador de PTYs entra como `terminals`.
- **Limites:** 10 terminais vivos, e 120 min sem cliente conectado encerram o terminal (também o que já saiu). Terminais não sobrevivem a reiniciar ou atualizar o daemon.
- **Claude aqui:** `terminal.open` com `claude: { resume? }` roda `flightdeckd claude` (e `--resume <id>`) no cwd, no lugar de um shell, e é incompatível com `command`. O `resume` precisa ser um id simples, sem hífen na frente.
  - O terminal cria o `launch_id` e o passa em `FLIGHTDECK_TERMINAL_LAUNCH_ID`. O wrapper o adota se for um ULID válido (senão gera um) e o tira do ambiente do claude, para um `flightdeckd claude` dentro do claude não o reaproveitar. A sessão que o terminal mostra é a que o app controla pelo canal.
  - Sem o `flightdeckd` configurado, o pedido é recusado com `invalid_state`.

## TDD e testes (terminal)

- **PTY falso nos testes:** só o `smoke:terminal` abre um PTY de verdade, com um script fixo do bun (imprime os pids e ecoa as linhas). Os testes usam um PTY falso, e os de ponta a ponta do Claude aqui usam um executor por pipes que recusa qualquer argv que não seja o `flightdeckd`, para um vermelho nunca abrir um shell.
- **Vermelho do `smoke:terminal`:** rodado numa cópia da base `c11f234`, com `SMOKE TERMINAL FAIL no passo "abrir o terminal"` (o `terminal.open` não existe) e código 1.
- **Linux:** o smoke e os testes do terminal rodaram também num contêiner `oven/bun:1.4.4`, com o PTY de verdade do Linux.

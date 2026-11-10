# Decisões e divergências da Fase 7, trilha A (phase 7)

O que a spec da Fase 7 (operação do host) deixou aberto, ou o que mudou na implementação.

## Versões

- **`Cargo.toml` fica em `0.1.0`:** a versão do crate Rust não está entre as quatro da spec (protocolo, daemon, desktop e `tauri.conf.json`). O `tauri.conf.json` lê a versão do `package.json` do desktop (`"version": "../package.json"`), e o `cargo check` passa.
- **Versão de referência do `update`:** é a do binário que roda o comando (`DAEMON_VERSION`), não a do binário instalado. O README diz para rodar o `update` com o binário instalado e, na primeira vez, com o próprio binário novo.

## Protocolo

- **Ordem no `hello`:** o token é conferido antes da versão. Token errado continua fechando a conexão como `unauthorized`. Versão fora do intervalo recebe o ack `protocol_incompatible`, e a conexão fica aberta sem autenticar: outro `hello` pode vir, e qualquer outro comando a fecha como `unauthorized` (o `smoke:ops` confere).
- **`features` ausente:** daemons anteriores à Fase 7 não mandam o campo. O app trata ausência como legado: mostra o que já existia (hooks da central, Projetos) e esconde o que nasceu na Fase 7 (Manutenção). Com o campo presente, só aparece o que está nele.
- **Host incompatível no app:** o status `incompatible` não tenta reconectar sozinho. O botão Reconectar da página do host tenta de novo.
- **Opções do servidor para testes:** `protocolRange` e `features` em `startServer` existem para os testes simularem daemons de outros intervalos e recursos.

## Retenção

- **Sem migração:** a última limpeza fica em `<dataDir>/maintenance.json`. A única migração da fase continua sendo a da trilha B.
- **Etapas de workflow:** a regra "sessões de cards fora de Concluído" também protege as sessões das etapas de workflow desses cards (`step_runs` → `workflow_runs` → card).
- **Conversa removida no app:** detectada no cliente, sem campo novo no protocolo. Um `session.subscribe` desde o começo que replica 0 eventos de uma sessão com `lastSeq` > 0 marca a sessão. A mensagem aparece na `SessionView`, que o detalhe do card usa.
- **Boot com `eventsDays: 0`:** a limpeza do boot apaga de novo a conversa de um banco restaurado. O `smoke:ops` confere o conteúdo restaurado no arquivo, antes de subir o daemon, e depois só que a sessão existe.

## Backup

- **Nome em UTC:** `flightdeck-AAAAMMDD-HHmmss.db` usa UTC, para os nomes seguirem a ordem do tempo em qualquer fuso.
- **`--out`:** um backup com destino explícito não entra na rotação de `keep`.
- **Backup do boot:** só é feito se o último tiver 24 h ou mais, para reinícios seguidos não gerarem cópias.

## Atualização

- **`.old` em todos os sistemas:** a spec pede rename para `.old` no Windows e cópia para um temporário com rename por cima nos outros. Aqui todos fazem as duas coisas: o atual vira `.old`, o novo é copiado para `.new` e renomeado por cima. Assim o Linux também tem para onde voltar.
- **Parar o daemon do serviço:** numa tarefa real, o orquestrador confirmou que `schtasks /End` encerra o `conhost.exe` e deixa o `flightdeckd` vivo, com o lock e o `/health`. Por isso o `update` e o `service uninstall` seguem a mesma sequência (`stopServiceDaemon`):
  1. `daemon.shutdown` pelo WebSocket, com o token da config. Ele funciona em qualquer sistema.
  2. Depois, `schtasks /End` ou `systemctl --user stop`.
  3. Espera até 10 s pelo lock do `dataDir`.
  4. Com o lock ainda ocupado, mata o PID do lock só se o executável desse processo for o do serviço. A comparação é feita com os links resolvidos, porque um gerenciador de pacotes pode instalar o executável atrás de uma junção. O caminho vem do PowerShell no Windows e de `/proc/<pid>/exe` nos outros sistemas.
  5. Se não for o executável do serviço, o `update` recusa sem trocar nada. O `uninstall` remove o serviço e avisa que o daemon continua rodando.
- **`daemon.shutdown`:** é só uma adição ao protocolo, sem item em `features`, porque o app não o usa. Um daemon antigo responde `bad_request`, e a sequência segue para o `stop` do serviço e o lock. O daemon responde ao comando e depois fecha como no SIGTERM, saindo com 0 para o `RestartOnFailure` da tarefa não religá-lo.
- **Caminho e config do serviço:** lidos de volta do sistema, pelo `ExecStart` de `systemctl --user cat flightdeckd` e pelo `<Arguments>` de `schtasks /Query /XML` (depois de `--headless`). O comando é tudo o que vem antes de `start`, como `bun run bin.ts` na árvore de código; a config é o argumento depois de `--config`. Pelo pipe, o `schtasks` escreve na página de código ANSI. Um caminho com acentos pode não bater, e o serviço é reinstalado sem necessidade, o que não causa dano.
- **Config do serviço no `update`:** a reinstalação no caminho estável mantém o `--config` que o serviço tinha. Sem `--config` no CLI, a config do serviço define a porta do `/health`, o lock e o token do `daemon.shutdown`. Nesse caso, a config padrão nem é lida.
- **Hooks:** reinstalados quando o `hooks.status` para o caminho estável dá `outdated`, isto é, há hooks do Flightdeck que diferem dos que seriam escritos. Ausentes continuam ausentes.
- **Volta automática:** se o daemon novo não responde, o `.old` volta para o lugar, se existir. Se o serviço tinha sido reinstalado, ele volta ao comando e à config originais, lidos do XML ou da unit, e sobe de novo. O primeiro `update`, sem binário anterior, fica assim como estava antes.
- **`/health`:** o endereço vem do `bind` e da `port` da config (`0.0.0.0` e `::` viram `127.0.0.1`), como no `flightdeckd mcp`.

## Serviço (defeito da Fase 2)

- **`--config` no serviço:** com `service install --config <arquivo>`, a tarefa e a unit rodam `start --config <caminho absoluto>`, com as mesmas regras de aspas de antes. Sem `--config`, continuam com `start` e a config padrão. Antes, o `--config` só servia para gravar o `claude.executablePath`.
- **`service status`:** mostra também a config que o serviço usa, ou "padrão".
- **`service stop` e `service start`:**
  - o `stop` usa a mesma `stopServiceDaemon` do `update` e do `uninstall`, e deixa a tarefa ou a unit instalada;
  - o `start` roda `schtasks /Run` ou `systemctl --user start` e espera o `/health` da config do serviço, por até 30 s;
  - os dois saem com 1 sem serviço instalado, com um daemon que não parou ou sem resposta no `/health`;
  - a restauração no README é `service stop`, `restore` e `service start`.
- **`bun run deploy`:** continua trocando o `path` do `deploy.hosts.json`. O README pede para apontá-lo para `~/.flightdeck/bin/flightdeckd` depois do primeiro `update`.

## Travas novas

- **Serviço real:** `osServiceContext` executa por um `exec` vigiado. Com `FLIGHTDECK_SERVICE_GUARD` definido, `systemctl`, `schtasks` e `loginctl` (com caminho ou `.exe`) não rodam: a linha vai para o arquivo da variável, e o resultado é o código 99. O preload define a variável para a suíte, e o `afterAll` reprova se o arquivo existir. O `smoke:ops` faz o mesmo.
- **Binário real:** o preload e o `smoke:ops` tiram um retrato de `~/.flightdeck/bin/flightdeckd(.exe)` e dos seus `.old` e `.new` no home real, antes da trava de home, e reprovam se algo mudar.
- **Escopos:** a trava do serviço tem o próprio escopo (`trava-servico`). A do binário veio no ciclo do `update`, que é quem mexe no binário.

## TDD e testes

- **Ramos revelados pela cobertura (regra 7):**
  - `db` com ação desconhecida;
  - o `healthy` do CLI do `update`, que confere `GET /health` no endereço da config;
  - o ramo MB do `formatBytes`;
  - o ramo `/proc/<pid>/exe` do `processPath`, que não roda no Windows (testado com `readlink` injetado).
- **Correções de teste antes do `feat` ou `fix` (regra 8):**
  - o ack do daemon falso do `versoes-ui` não devolve valor, como pede o tipo do websocket do Bun;
  - no `manutencao-ui`, a espera pela limpeza real aguarda a mensagem da simulação sumir, porque "seriam apagados: …" também contém "apagados: …";
  - os testes de `install --dry-run` passam `--config`, então a unit e a tarefa esperadas passaram a levá-lo;
  - o exemplo de `daemon.shutdown` no teste do protocolo;
  - nos testes do CLI do `update`, o daemon falso recebe primeiro a tentativa de `daemon.shutdown` em `/v1/ws` e depois o `/health`;
  - o caminho do próprio processo é comparado com os links resolvidos (o bun do Scoop roda atrás da junção `current`).
- **Escopo `desligar`:** o `daemon.shutdown` ganhou o próprio ciclo (`test` e `feat`). As correções do `--config` e do `uninstall` são `fix(servico)`, e as do `update` são `fix(update)`.
- **`central-ui`:** o teste de ordem esperava a sessão gerenciada ficar ociosa antes de seguir. Sob a carga da suíte inteira, a ordem às vezes falhava, e isso foi corrigido num `test(central-ui)`.
- **`smoke:ops` sem vermelho de recurso:** o script foi escrito depois das áreas que ele cobre. As primeiras execuções falharam com saída controlada, mas por expectativas do próprio script: um comando numa conexão incompatível fecha como `unauthorized` em vez de receber ack, e a limpeza do boot apaga de novo o banco restaurado. Nenhuma falha veio de recurso faltando. O script foi commitado verde no `test(smoke-ops)`.

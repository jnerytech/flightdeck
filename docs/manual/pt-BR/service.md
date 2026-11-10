# Serviço

[Voltar ao manual](../pt-BR.md) · [English](../en/service.md)

## Primeira execução: flightdeckd setup

A primeiríssima execução é o próprio arquivo baixado, porque ainda não há nada no seu `PATH`.
No Windows, abra o PowerShell na pasta do download:

```powershell
Unblock-File .\flightdeckd-windows-x64.exe   # só se o Windows bloquear o arquivo ("baixado da Internet")
.\flightdeckd-windows-x64.exe setup
```

Quando o `setup` terminar, abra um **novo terminal** e digite `flightdeckd` em qualquer pasta: a
cópia em `~/.flightdeck/bin` se chama `flightdeckd.exe` (`flightdeckd` nos outros sistemas) e
essa pasta agora está no seu `PATH`. Depois disso:

```sh
flightdeckd setup                          # pergunta, passo a passo
flightdeckd setup --yes --folders ~/code   # sem perguntas, para scripts (pastas separadas por vírgula)
flightdeckd doctor                         # o que falta, com o comando que conserta cada coisa
```

O `setup` faz, nesta ordem:

1. copia o binário em execução para `~/.flightdeck/bin`. Se já houver um lá, o `setup` pergunta
   a versão dele: um **mais antigo** (ou que não responde a `--version`) é trocado, depois de
   parar o daemon do serviço, e fica guardado como `flightdeckd.old`; a mesma versão ou uma
   **mais nova** fica, e o `setup` avisa. Ele sempre imprime qual binário e versão o serviço
   vai rodar. Depois coloca essa pasta no seu `PATH`. No Windows ela entra no `Path` do
   **usuário** (registro `HKCU\Environment`, sem duplicar e mantendo as outras entradas) e os
   programas abertos são avisados, então só terminais abertos depois a enxergam. No Linux e no
   macOS acrescenta a linha `export PATH="$HOME/.flightdeck/bin:$PATH"` ao `~/.profile` uma só vez
   (um segundo `setup` não acrescenta nada, e o resto do arquivo é mantido; se não conseguir
   gravar, imprime a linha para você pôr). O `service uninstall` tira a entrada do `Path` do Windows;
2. pergunta as pastas dos projetos, uma por resposta, e recusa pasta que não existe: elas viram
   `allowedRoots` na config;
3. com a Tailscale ativa, pergunta se você usa o Flightdeck de outros dispositivos (o padrão é
   **não**). Sim liga o daemon só no endereço da Tailscale, nunca em todas as interfaces, e deixa
   entrar só o loopback e as faixas da Tailscale;
4. oferece instalar os hooks do Claude Code;
5. instala o serviço **e o inicia agora**, esperando o `/health`;
6. imprime o link de pareamento e o QR.

Quando a entrada acaba (um script sem `--yes`), o `setup` para com código 1 em vez de ficar em
laço. O `service install` também inicia o serviço agora, sozinho. O `doctor` confere a config,
as pastas, o serviço, o `/health` do daemon, o `claude`, os hooks e a Tailscale, uma linha cada,
e imprime o conserto de cada falha; sai com 1 quando uma checagem falha.

## Instalar como serviço

O daemon sobrevive a reboot e a SSH fechado rodando como serviço do próprio usuário:

```sh
flightdeckd service install --dry-run   # mostra a unit ou a tarefa, não altera nada
flightdeckd service install [--config <arquivo>]
flightdeckd service status              # estado e a config que o serviço usa
flightdeckd service stop                # para o daemon; o serviço continua instalado
flightdeckd service start               # sobe o serviço e espera o /health
flightdeckd service uninstall           # para o daemon e remove o serviço
```

- **Config:** com `--config`, o serviço roda `start --config <caminho absoluto>`; sem, usa
  `~/.flightdeck/config.json`.
- **Parar:** o `stop` e o `uninstall` seguem a mesma sequência:
  - pedem `daemon.shutdown` ao daemon;
  - param a tarefa ou a unit;
  - esperam o lock do `dataDir`, encerrando o processo só se ele for o executável do serviço.

  No Windows, `schtasks /End` sozinho não basta: ele encerra o `conhost.exe` e deixa o daemon
  rodando. O `start` sobe o serviço e espera o `/health` da config dele por até 30 s.

- **Linux (WSL, Orange Pi, VPS):** grava `~/.config/systemd/user/flightdeckd.service`
  (`Restart=always`, `RestartSec=5`) e roda `systemctl --user enable --now flightdeckd`. Sem
  *linger*, o serviço só sobe depois do seu login; o `install` imprime o comando
  `sudo loginctl enable-linger $USER` para você rodar (ele nunca executa nada com sudo). O `setup`
  termina com um bloco de **AVISO** com esse comando quando o linger está desligado (no WSL diz
  também para ligar `systemd=true` em `/etc/wsl.conf`), e o `flightdeckd doctor`, e o Doutor do host
  no app, mostram "linger" como falha até ele ser ligado.
- **Windows:** cria a tarefa agendada `Flightdeck\flightdeckd` no logon do usuário, sem
  privilégio elevado e sem janela visível (importa um XML com `schtasks /Create /XML`; o console
  fica escondido por `conhost.exe --headless`).
- O comando do serviço é o binário compilado; rodando a partir do código-fonte, vira
  `bun run apps/daemon/src/bin.ts start`.
- Serviço não herda o `PATH` do shell: o `install` grava o caminho do `claude` em
  `claude.executablePath` na config (no Windows, prefere `claude.exe`; um `.cmd` gera aviso).
  O `--dry-run` só mostra o caminho que seria gravado e não cria nem altera a config.
- Serviço também não carrega o `.bashrc`: faça `claude auth login` em cada host em vez de
  depender de `CLAUDE_CODE_OAUTH_TOKEN` exportado no shell.
- Dois daemons com o mesmo `dataDir` não convivem: o segundo sai com código 3 ("já em execução").

## WSL a partir do Windows

O daemon do Windows pode manter o daemon de cada distro WSL rodando (e a distro acordada):

```json
"wsl": [{ "distro": "Ubuntu", "command": "~/.local/bin/flightdeckd start", "port": 7430 }]
```

Cada item vira `wsl.exe -d <distro> --exec bash -lc "<command>"`, reiniciado com backoff de 1 s
até 60 s, com log em `dataDir/logs/wsl-<distro>.log`. O daemon do WSL escuta em
`127.0.0.1:7430`, que o Windows alcança por `localhost`. Se esse daemon também recebe hooks, o
`hooks.port` dele precisa ser diferente do do Windows (veja [Hooks do Claude Code](session-hub-and-claude-code-hooks.md#hooks-do-claude-code)).

**Configurando o daemon do WSL.** Rode `flightdeckd setup` dentro da distro. O WSL compartilha o
`localhost` com o Windows, então o setup detecta o WSL (`WSL_DISTRO_NAME`, ou `/proc/version`) e
sobe em 10 as portas que ainda estão nos padrões do daemon do Windows: `port` 7430, `hooks.port`
7431 e `telemetry.port` 7432 (o Windows fica com 7420, 7421 e 7422). Elas são gravadas no
`config.json`, então ninguém precisa editá-lo à mão; uma porta que você mesmo definiu fica como
está, e rodar o setup de novo não muda nada. Uma config nova no WSL também chama o host de
"<hostname> (WSL <distro>)", para distinguir os dois daemons no app.

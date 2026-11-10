# Operação do host

[Voltar ao manual](../pt-BR.md) · [English](../en/host-operations.md)

## Versões e compatibilidade

- **Uma versão só:** o app, o daemon e o protocolo saem com a mesma versão (0.14.0 nesta
  documentação). `flightdeckd --version` imprime `flightdeckd <versão> (protocolo 1)`.
- **No app:** a página do host mostra a versão do daemon, a do app e a do `claude`. Um daemon de
  outra versão ganha o selo **≠** ("versão diferente") na barra lateral: funciona, mas atualize
  quando puder. Passar o mouse sobre um host na barra lateral, ou levar o foco do teclado até ele,
  mostra a versão do daemon numa dica (no trilho estreito, depois do nome).
- **Protocolo:** o app manda a versão de protocolo dele no `hello`. Se o daemon não a aceita, o
  host fica **incompatível: atualize o daemon**, com o comando na página do host. Ele não tenta
  reconectar e sai das listas (sessões, busca) até ser atualizado e reconectado.
- **Recursos:** o `host.info` anuncia o que o daemon tem (`central`, `workflows`,
  `maintenance`…), e o app esconde o que o host não anuncia. Um daemon anterior à Fase 7 não
  anuncia nada e continua aparecendo como antes, sem a seção Manutenção.

## Atualizar com flightdeckd update

```sh
flightdeckd update --from <binário novo> [--allow-downgrade] [--config <arquivo>]
```

O `update` instala sempre em `~/.flightdeck/bin/flightdeckd` (`flightdeckd.exe` no Windows):

1. Roda `<binário novo> --version` e recusa o que não responder como um `flightdeckd`. Uma versão
   menor que a de quem roda o `update` só passa com `--allow-downgrade`.
2. Com o daemon rodando fora do serviço, recusa: "pare o daemon e rode de novo". Com serviço:
   - pede `daemon.shutdown` ao daemon e para o serviço;
   - espera o daemon soltar o `dataDir`;
   - se o lock continua preso, encerra o processo, mas só se ele for o executável do serviço.
3. Guarda o binário atual como `flightdeckd.old` (`.exe.old`) e põe o novo no lugar.
4. Se o serviço apontava para outro caminho (por exemplo `dist/` ou `~/.local/bin`), reinstala o
   serviço no caminho estável, com o mesmo `--config`. Os hooks do Claude Code são reescritos só
   se já estavam instalados e apontam para outro lugar. A saída diz o que foi reescrito.
5. Sobe o serviço e espera `GET /health` responder por até 30 s. Sem `--config` no `update`, a
   porta vem da config do serviço. Se o daemon novo não sobe:
   - o `.old` volta para o lugar;
   - o serviço volta ao caminho e à config de antes e sobe de novo;
   - o comando sai com 1.

   O `.old` de um update bem sucedido é apagado no próximo.

Sem serviço instalado, o `update` só instala o binário e diz como subir. Use o binário instalado
para rodar o `update` (ele compara a versão nova com a dele); na primeira vez, rode o próprio
binário novo.

- **Windows:** `bun run build:daemon`, depois
  `~\.flightdeck\bin\flightdeckd.exe update --from dist\flightdeckd-windows-x64.exe` (na primeira
  vez, `dist\flightdeckd-windows-x64.exe update --from dist\flightdeckd-windows-x64.exe`).
- **WSL:** copie o binário Linux para dentro da distro e rode o `update` lá:
  `cp /mnt/<drive>/<repo>/dist/flightdeckd-linux-x64 ~/` e
  `~/.flightdeck/bin/flightdeckd update --from ~/flightdeckd-linux-x64`.
- **Linux remoto (VPS, Orange Pi):** `scp dist/flightdeckd-linux-arm64 <host>:~/` e, no host,
  `~/.flightdeck/bin/flightdeckd update --from ~/flightdeckd-linux-arm64`.

## Sessões que um reinício interrompeu

Quando o daemon de um host reinicia (uma atualização, um boot, um reinício do serviço), as sessões que
estavam rodando ficam em `error` com o motivo *o daemon reiniciou*. Quando o app reconecta a um daemon
que oferece isso, um diálogo, **Retomar as sessões interrompidas**, lista as das últimas 24 horas,
agrupadas pela pasta do projeto, cada uma com a persona, quanto tempo rodou e o último pedido. Todas
vêm marcadas. O diálogo diz o que retomar faz: reconecta cada sessão e envia *Continue where you left
off.*; o pedido original nunca é enviado de novo. **Retomar as escolhidas** retoma as marcadas (cada
linha termina como *Retomada*, ou como *Não foi possível retomar: <motivo>* com um botão **Tentar de
novo**, e as outras não são afetadas); **Agora não** fecha o diálogo e ele só volta num próximo
reinício (a página do host guarda um botão *Retomar as sessões interrompidas (N)* para reabrir);
**Dispensar todas** descarta a oferta de vez. A página do host também tem uma chave, **Retomar sozinho
depois de um reinício**, desligada por padrão: ligada, nenhum diálogo aparece, as sessões são retomadas
na hora e um aviso as lista. Ainda não: um estado *na fila* quando o limite paralelo é atingido, o
coordenador de um time retomado antes dos seus workers e uma entrada na barra de status para reabrir a
oferta.

## Atualização automática assinada

Cada release traz os instaladores e os daemons assinados com a chave do projeto (minisign, gerada
pelo `tauri signer`). A chave pública está em
[`release/flightdeck.pub`](../../../release/flightdeck.pub), e o app e o daemon só aceitam o que ela
assinou. Isso vale para as atualizações: o instalador do Windows em si não tem assinatura
Authenticode (veja [Instalação](installation.md#pelos-binários-da-release)).

- **O app:**
  - procura a versão nova ao abrir e a cada 6 h, no `latest.json` da última release;
  - com **Atualizar automaticamente** ligado (o padrão), baixa a versão nova em segundo plano,
    confere a assinatura e então mostra um cartão no canto inferior direito: **Atualização
    disponível**, "O Flightdeck vX está pronto.", "Suas sessões não serão interrompidas." (elas rodam
    nos daemons dos hosts), **Notas da versão** (a página da versão no GitHub), um botão
    **Atualizar** e um botão de fechar (×) que o guarda até a próxima verificação (#490). Nada
    reinicia sozinho (#280). Sair pela
    bandeja com uma versão baixada a instala na saída, sem abrir o app de novo (#402);
  - com ele desligado, a faixa diz "Flightdeck X disponível", com as notas, **Instalar e
    reiniciar** e **Depois**, como antes;
  - assinatura inválida ou download quebrado aparecem na faixa, e nada é instalado; um download que
    falhou é tentado de novo na próxima verificação;
  - em **Configurações**: **Procurar atualização agora**, **Avisar sobre atualizações** e
    **Atualizar automaticamente** (os dois ligados por padrão).
- **O daemon:**
  - verifica o `daemon-latest.json` ao subir, quando pedido e a cada `updates.checkIntervalH`
    (6 h por padrão);
  - na página do host, o app mostra **Atualizar daemon para X** quando há versão nova, e pede
    confirmação;
  - a página do host mostra também quando o daemon verificou pela última vez, e o erro dessa
    verificação se ela falhou, com **Verificar atualizações**: pede ao daemon que olhe o manifesto
    agora (comando `daemon.update.check`). Quando o app é mais novo que o daemon, a página faz isso
    sozinha uma vez ao abrir, no máximo a cada 10 minutos por host. Um daemon anterior a esse
    comando o recusa, e a página diz o motivo; atualize esse à mão com `flightdeckd update`;
  - o daemon baixa o binário do próprio sistema para `<dataDir>/updates/`, confere o sha256 e a
    assinatura, e roda o `flightdeckd update --from` fora do serviço, para sobreviver à própria
    parada: uma tarefa única `Flightdeck\update` no Windows e `systemd-run --user` no Linux;
  - o host mostra "atualizando…" até reconectar na versão nova;
  - **sozinho** (`updates.auto`, ligado por padrão; #280): quando uma verificação acha versão mais
    nova, o daemon a aplica só com o host ocioso, sem sessão nem execução em andamento, e senão
    espera. Nunca aplica uma versão mais velha. Uma aplicação que falha mantém o binário antigo e é
    tentada de novo na próxima verificação. A página do host tem **Atualizar este host
    automaticamente** (a mesma configuração, guardada pelo daemon) e diz se a atualização está
    desligada, em dia, esperando, começou ou falhou, e por quê.
- **Ordem:** com o app e os daemons atrasados, a faixa sugere atualizar primeiro o app.

```json
{ "updates": { "manifestUrl": "https://github.com/jnerytech/flightdeck/releases/latest/download/daemon-latest.json",
               "checkIntervalH": 6, "auto": true } }
```

Só o `flightdeckd` compilado verifica o GitHub por padrão. Rodando do código-fonte não há binário
para atualizar, e o `manifestUrl` padrão é `null`.

**Quando falha:**

- **"o daemon não roda como serviço":** a atualização pelo app precisa do serviço. Instale com
  `flightdeckd service install`, ou atualize à mão com `flightdeckd update --from`.
- **Verificação recusada** (sha256 ou assinatura): o arquivo baixado é apagado e nada muda. Baixe
  de novo da página de Releases e confira o `SHA256SUMS`.
- **O host não volta em 2 minutos:** a página do host mostra o comando manual. No host, rode
  `~/.flightdeck/bin/flightdeckd service status` e, se preciso, `flightdeckd update --from` com o
  binário da release. A volta automática do `update` restaura a versão anterior quando a nova
  não sobe.

## Retenção

```json
{ "retention": { "eventsDays": 90, "externalSessionsDays": 30 } }
```

- **Apaga:** eventos e pedidos de permissão de sessões gerenciadas encerradas há mais de
  `eventsDays` dias, e sessões externas encerradas há mais de `externalSessionsDays` dias. `0`
  apaga assim que a sessão encerra.
- **Nunca apaga:** sessões vivas, sessões fixadas, sessões de cards fora de Concluído (inclusive
  as etapas de workflow desses cards), os cards, as execuções de workflow e os nomes e
  marcações das sessões. O índice do histórico segue os transcripts e fica de fora.
- **Quando:** no boot do daemon e a cada 24 h. À mão, `flightdeckd db prune [--dry-run]` mostra
  a contagem por tabela; no app, a seção **Manutenção** da página do host tem **Simular** e
  **Limpar** (que pede confirmação).
- Uma conversa limpa aparece como "conversa removida pela retenção".
- O uso de custos tem retenção própria: `retention.usageDays` (veja [Custos](costs-budgets-and-quota.md#custos)).

## Backup e restauração

```json
{ "backup": { "enabled": true, "keep": 7 } }
```

- **Automático:** uma vez por dia, `VACUUM INTO <dataDir>/backups/flightdeck-<AAAAMMDD-HHmmss>.db`
  (horário UTC), mantendo os últimos `keep`. Funciona com o daemon rodando.
- **À mão:** `flightdeckd backup [--out <arquivo>]`, ou **Fazer backup agora** na seção
  Manutenção. Os arquivos ficam só para o dono (0600 fora do Windows).
- **Restaurar:** `flightdeckd service stop`, depois `flightdeckd restore <arquivo>`, depois
  `flightdeckd service start`. Sem serviço, pare o daemon à mão antes do `restore`. O comando
  recusa com o daemon rodando, confere a integridade e se o backup não veio de uma versão mais
  nova, e guarda o banco atual em `flightdeck.db.before-restore`. As migrações que faltarem rodam
  no boot seguinte.
- **A `config.json` fica fora do backup**, porque tem os tokens: guarde uma cópia à parte.

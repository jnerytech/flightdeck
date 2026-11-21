# Comandos do flightdeckd: as sessões em segundo plano de um host

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-bg-commands.md)

Os verbos que listam e controlam as sessões em segundo plano de um host: as sessões que o Claude Code roda com
`claude --bg`, sem terminal ligado. Funcionam como os outros comandos do `flightdeckd`: veja
[o que todos têm em comum](flightdeckd-commands.md#o-que-todos-têm-em-comum). Aceitam `--host <nome>` para rodar em um
host pareado e `--json` para imprimir o valor que o daemon devolve.

## fd bg

```sh
fd bg list
fd bg list --json
fd bg list --host pi
```

`list` imprime quantas sessões em segundo plano o host tem e depois uma linha para cada uma: seu id, seu estado
(`working`, `blocked`, `done`, `failed` ou `stopped`), enquanto o processo está vivo se está `busy`, `waiting` ou
`idle`, o que uma sessão em espera aguarda (`permission prompt`, `input needed`), seu nome (a pasta quando não tem nome)
e quanto custou até agora. Não muda nada.

```text
2 background sessions
  ab12 working (busy) fix the parser $0.42
  cd34 blocked (waiting), waiting for permission prompt /work/web
```

Um host sem nenhuma imprime `no background sessions`. Um host cujo `claude` é antigo demais para tê-las imprime
`this host's claude has no background sessions` e sai com `0`: é um fato sobre o host, não uma falha.

Com `--json` imprime `supported` e a lista de sessões, cada uma com `id`, `name`, `cwd`, `state`, `status`,
`waitingFor`, `pid`, `claudeSessionId`, `startedAt` (milissegundos Unix) e `costUsd`, e `null` onde o daemon não tem
valor. Quando `supported` é `false` a lista vem vazia.

```sh
fd bg start --cwd /work/api --prompt "fix the parser" --name parser
fd bg start --card 9f2c --persona fd-developer
fd bg stop ab12
fd bg respawn ab12
fd bg message ab12 --text "use a segunda abordagem"
```

`start` roda uma nova sessão em segundo plano e imprime o id dela. Dê uma pasta e um prompt, ou um cartão (a pasta do
projeto dele e o texto dele), nunca os dois; `--name` (até 120 caracteres) e `--persona` são opcionais. O daemon só roda
em uma pasta que ele permite, e uma pasta em que ele não confia roda sem os hooks e servidores do projeto. `stop`
encerra uma sessão, `respawn` inicia de novo uma sessão parada na pasta dela, e `message` escreve o texto (até 32000
caracteres) em uma. Uma sessão que está rodando e não tem canal para escrever é recusada com o motivo: só aceita
mensagem uma sessão iniciada com `flightdeckd claude`, ou uma parada. Escrever em uma sessão parada a retoma com esse
texto.

Cada um imprime uma linha (`started background session ef56`, `stopped ab12`, `respawned ab12`,
`sent a message to ab12`) e, com `--json`, o id da nova sessão ou as sessões que o daemon lista depois. Uma recusa do
daemon (segundo plano desligado, uma pasta que ele não permite, um cartão desconhecido) é saída `1` com a mensagem dele.
Os comandos que mudam uma sessão esperam até um minuto pelo `claude`; se o daemon não responde nesse tempo a saída é
`2`, e o comando pode ter rodado ou não: veja com `fd bg list` antes de rodá-lo de novo.

No shell de uma sessão do próprio Flightdeck as quatro escritas são de risco alto e esperam a pessoa no app, já que um
comando digitado não é a pessoa: só `fd bg list` roda sozinho.

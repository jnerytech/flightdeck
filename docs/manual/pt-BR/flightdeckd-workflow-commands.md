# Comandos do flightdeckd: os workflows de um projeto e suas execuções

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-workflow-commands.md)

Os verbos que leem os workflows de um projeto e suas execuções: os workflows com o hash e a confiança de cada um, os
modelos que o projeto pode adicionar, um workflow verificado de novo, uma execução com seus passos, um fluxo de cada
mudança de uma execução e se uma execução que falhou pode retomar. Três verbos mudam algo: confiar em um workflow,
adicionar um modelo e retomar uma execução que falhou. Funcionam como os outros comandos do `flightdeckd`: veja
[o que todos têm em comum](flightdeckd-commands.md#o-que-todos-têm-em-comum). Responder a um gate continua no app.

## fd workflow

```sh
fd workflow list api
fd workflow templates api
fd workflow validate api ship
fd workflow run r1 --json
fd workflow watch
fd workflow resume r1
fd workflow trust api ship --hash <o hash que list imprimiu>
fd workflow template-add api review-loop --confirm
fd workflow resume r1 --confirm
```

Um projeto é o nome ou o id dele.

`list <projeto>` imprime os workflows da branch base, uma linha cada: o nome, o hash inteiro do arquivo, `trusted`,
`untrusted` ou `invalid`, quantos comandos `check` ele pode rodar e suas entradas. Um workflow com erros imprime cada um
abaixo dele como `error: ...`. Um projeto sem workflows imprime `no workflow in .flightdeck/workflows on the base branch`.

`templates <projeto>` imprime os workflows que acompanham o produto: o id, o título, onde o arquivo vai, a persona dos
passos de agente e se a linha `check` traz o comando de teste do projeto (`filled`), um marcador que falha
(`placeholder`) ou nenhum.

`validate <projeto> <workflow>` verifica um workflow de novo e o imprime por inteiro: o nome, o hash e o estado, depois
suas entradas, seus comandos de verificação e seus erros. Um workflow com erros sai com `0`: os erros são o resultado.

`run <execução>` imprime uma execução: o estado e o motivo, o que ela gastou, até quando espera a cota do plano e cada
passo com tentativa, tipo, estado e código de saída. Uma execução desconhecida sai com `1`.

`watch` escreve uma linha a cada mudança de uma execução neste host, começando pelas que estão ativas, até Ctrl-C
(saída `0`). Com `--json` cada linha é uma execução.

`resume <execução>` só verifica: imprime de onde uma execução que falhou retomaria e não inicia nada. Quando não pode
retomar, imprime o motivo, com os parâmetros dele, e sai com `1`. O motivo é uma palavra estável que um script pode ler; com `--host` o daemon responde
`transport_refused` para toda execução, então rode a verificação no próprio host.

`trust <projeto> <workflow> --hash <hash>` dá ao workflow a confiança para rodar seus comandos de shell e o imprime como
`validate`. O hash são os 64 caracteres inteiros que `list` imprimiu: o comando nunca lê um por você. Um workflow que
mudou desde que você leu o hash, ou que tem erros, é recusado com saída `1`. Confiar deixa os comandos do workflow
rodarem no host, então exige uma conexão próxima, como `template-add`: por uma conexão distante (nem este computador nem a Tailscale) o daemon recusa.

`template-add <projeto> <modelo> --confirm` faz o commit do modelo em uma branch nova do projeto e abre o pull request,
depois imprime o arquivo, a branch, a base e o pull request. Sem `--confirm` sai com `1` e não muda nada. Pede uma
conexão do computador em que o daemon roda: com `--host` o daemon recusa.

`resume <execução> --confirm` roda de novo os comandos do projeto a partir do passo que falhou e imprime `<execução>
resumed from <passo>`. Pede a mesma conexão próxima. Uma execução que não pode retomar imprime o motivo e sai com `1`.

`--hash` e `--confirm` são só a palavra de quem os digita: o shell de uma sessão também pode digitá-los, então uma
sessão que roda esses três verbos para e espera a resposta da pessoa. Se a conexão cair com um deles em andamento, o
comando sai com `2` e diz que a mudança pode ou não ter acontecido: olhe com `list`, `run` ou as branches do projeto
antes de rodá-lo de novo.

Com `--json` os comandos imprimem o que o daemon respondeu. `--host <nome>` lê um host pareado.

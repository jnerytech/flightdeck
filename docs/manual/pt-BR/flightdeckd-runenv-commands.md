# Comandos do flightdeckd: o ambiente de execução de um cartão

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-runenv-commands.md)

Os verbos que leem o `run.yaml` de um projeto e os processos que um cartão executa a partir dele, e os três que
confiam no arquivo, iniciam esses processos e os param. Funcionam como os outros comandos do `flightdeckd`: veja
[o que todos têm em comum](flightdeckd-commands.md#o-que-todos-têm-em-comum). `config`, `get` e `watch` não mudam
nada.

## fd runenv

```sh
fd runenv config api
fd runenv config api --json
fd runenv get card-1
fd runenv watch
fd runenv trust api --hash 9f3a1c4e7b2d5a60c81e3f7a2b94d0e6a1c5f8b37d2e4a96b0c3d7e1f5a8b2c4 --confirm
fd runenv start card-1 --confirm
fd runenv stop card-1
```

`config <projeto>` imprime o `run.yaml` de um projeto, nomeado pelo nome ou pelo id: o hash, se é confiável, cada
erro e, depois, o que ele executaria: as portas, os comandos de preparação e uma linha para cada processo com o
comando, a verificação de pronto e os nomes das variáveis que ele define (nunca os valores). Um projeto sem arquivo
imprime `no run.yaml` e sai com `0`. Um nome que dois projetos compartilham é recusado com os ids deles.

`get <cartão>` imprime a execução de um cartão: o estado dela e o da preparação, as portas e uma linha para cada
processo com o terminal em que roda, se está rodando, se está pronto e o link. Um cartão que o host não conhece é
recusado com saída `1`.

`watch` imprime a execução de cada cartão a cada mudança, uma linha para cada, até Ctrl-C.

`trust <projeto> --hash <hash> --confirm` deixa o host executar os comandos do `run.yaml` do projeto. Passe o hash inteiro, de 64 caracteres,
que o `config` imprimiu depois de você ler o arquivo: se o arquivo mudou desde então, o host recusa e nada é aceito.
Imprime o arquivo como o `config`. `start <cartão> --confirm` executa a preparação e os processos do cartão e imprime
a execução como o `get`. Os dois exigem `--confirm`, porque fazem o host executar comandos. `stop <cartão>` os
encerra e não exige nada. Uma sessão que rode `trust` ou `start` no próprio shell por você é parada no pedido de
permissão como comando de risco alto: quem responde é você, no app. Se o host não responder depois que um dos três
foi enviado, o comando sai com `2` e diz para conferir com `runenv config` (para `trust`) ou `runenv get` antes de
tentar de novo.

Com `--json` os comandos imprimem o valor que o daemon devolve, com `null` para um campo ausente; em `config` isso
inclui os valores das variáveis que um processo define (e `watch --json` os imprime a cada atualização), então não
deixe essa saída em logs compartilhados. O texto imprime cada comando inteiro: um segredo vai em uma variável, não
na linha de comando. `--host <nome>` lê
um host pareado.

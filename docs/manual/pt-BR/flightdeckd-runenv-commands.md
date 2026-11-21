# Comandos do flightdeckd: o ambiente de execução de um cartão

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-runenv-commands.md)

Os verbos que leem o `run.yaml` de um projeto e os processos que um cartão executa a partir dele. Funcionam como os
outros comandos do `flightdeckd`: veja [o que todos têm em comum](flightdeckd-commands.md#o-que-todos-têm-em-comum).
Não mudam nada. Confiar em um arquivo, e iniciar ou parar os processos de um cartão, continuam no app.

## fd runenv

```sh
fd runenv config api
fd runenv config api --json
fd runenv get card-1
fd runenv watch
```

`config <projeto>` imprime o `run.yaml` de um projeto, nomeado pelo nome ou pelo id: o hash, se é confiável, cada
erro e, depois, o que ele executaria: as portas, os comandos de preparação e uma linha para cada processo com o
comando, a verificação de pronto e os nomes das variáveis que ele define (nunca os valores). Um projeto sem arquivo
imprime `no run.yaml` e sai com `0`. Um nome que dois projetos compartilham é recusado com os ids deles.

`get <cartão>` imprime a execução de um cartão: o estado dela e o da preparação, as portas e uma linha para cada
processo com o terminal em que roda, se está rodando, se está pronto e o link. Um cartão que o host não conhece é
recusado com saída `1`.

`watch` imprime a execução de cada cartão a cada mudança, uma linha para cada, até Ctrl-C.

Com `--json` os comandos imprimem o valor que o daemon devolve, com `null` para um campo ausente. `--host <nome>` lê
um host pareado.

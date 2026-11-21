# Comandos do flightdeckd: a biblioteca de documentos de um projeto

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-knowledge-commands.md)

Os verbos que leem a biblioteca de PRDs, RFCs, ADRs e specs de um projeto (os documentos com o status de cada um, o
texto que uma sessão recebe deles e se o projeto o recebe) e os que a mudam: o status de um documento, um documento novo
e o interruptor do feed. Funcionam como os outros comandos do `flightdeckd`: veja
[o que todos têm em comum](flightdeckd-commands.md#o-que-todos-têm-em-comum).

## fd knowledge

```sh
fd knowledge list api
fd knowledge list api --json
fd knowledge index api
fd knowledge feed api
fd knowledge set-status api docs/adr/0001-queue.md --status obsolete --hash <hash>
fd knowledge create api adr "Use a queue"
fd knowledge create api rfc "Queue" --body-file draft.md
fd knowledge set-feed api --off
```

Um projeto é o nome ou o id dele; uma pasta absoluta também serve, e o host recusa a que não permite (saída `1`).

`list <projeto>` imprime os documentos, uma linha cada: o caminho, o status (`valid`, `transitional`, `obsolete` ou
`unclassified`), o tipo (`prd`, `rfc`, `adr`, `spec` ou `-`), o título, o hash do que a lista leu do arquivo e, depois,
o que o documento acrescenta: o que ele `supersedes`, seus `problems` e seus `warnings`. Uma lista com menos documentos
do que o projeto tem termina com `more documents than this list holds`; um projeto sem documentos imprime
`no knowledge documents`.

`index <projeto>` imprime o Markdown que uma sessão recebe da biblioteca, como o host o escreveu. Quando nenhum
documento qualifica, ou o projeto não recebe a biblioteca, imprime `no document is given to sessions`. Com `--json` traz
o texto, quantos documentos ele nomeia (`fed`) e se algum ficou de fora (`truncated`).

`feed <projeto>` diz se as sessões do projeto recebem o índice: `on`, ou `off` e a pasta que o desliga (o próprio
projeto, ou uma acima dele). Um projeto que não é confiável não recebe o índice mesmo com o interruptor ligado, e a
linha diz isso.

Com `--json` os comandos imprimem um valor JSON com `null` para um campo ausente. As linhas de texto separam os campos
com dois espaços e um título pode tê-los: um script lê o `--json`. `--host <nome>` lê um host pareado.

`set-status <projeto> <arquivo> --status <status> --hash <hash>` dá ao documento o status `valid`, `transitional` ou
`obsolete`. O hash é o que o `list` imprimiu para o arquivo: o comando nunca o lê por você, então um arquivo que mudou
desde que você listou é recusado (saída `1`) e nada é escrito. Imprime o documento como o `list`.

`create <projeto> <tipo> <título>` escreve um documento novo na pasta do projeto para o tipo (`adr`, `rfc` ou `prd`), a
partir do modelo; nunca sobrescreve um. `--body-file <arquivo>` coloca o texto de um arquivo sob o título no lugar das
seções do modelo, até 100000 caracteres. O host recusa um título sem letra nem dígito, um documento que já existe e uma
pasta que sai do projeto. Imprime o documento novo como o `list`.

`set-feed <projeto> --on|--off` liga ou desliga o índice para as sessões do projeto e imprime como ficou, como o `feed`.
Uma sessão que roda isso pelo shell precisa do sim da pessoa nos dois sentidos, porque o índice é texto que toda sessão
do projeto passa a ler.

Quando uma escrita fica sem resposta do host (saída `2`), a mensagem diz que a mudança pode ou não ter sido feita:
confira com `knowledge list` (ou `knowledge feed`) antes de tentar de novo.

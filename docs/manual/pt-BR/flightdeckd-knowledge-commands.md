# Comandos do flightdeckd: a biblioteca de documentos de um projeto

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-knowledge-commands.md)

Os verbos que leem a biblioteca de PRDs, RFCs, ADRs e specs de um projeto: os documentos com o status de cada um, o
texto que uma sessão recebe deles e se o projeto o recebe. Funcionam como os outros comandos do `flightdeckd`: veja
[o que todos têm em comum](flightdeckd-commands.md#o-que-todos-têm-em-comum). Mudar um status, criar um documento e o
interruptor do feed continuam no app.

## fd knowledge

```sh
fd knowledge list api
fd knowledge list api --json
fd knowledge index api
fd knowledge feed api
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

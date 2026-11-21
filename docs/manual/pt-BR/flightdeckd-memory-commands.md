# Comandos do flightdeckd: a memória automática de um projeto

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-memory-commands.md)

Os verbos que leem a memória automática do Claude Code de um projeto: a pasta de notas que o Claude guarda para ele e
carrega no início de uma sessão. Funcionam como os outros comandos do `flightdeckd`: veja
[o que todos têm em comum](flightdeckd-commands.md#o-que-todos-têm-em-comum). Nenhum deles muda algo. A tela do
próprio app está em [Memória, contexto e plugins](memory-context-and-plugins.md).

## fd memory

```sh
fd memory list api
fd memory read api MEMORY.md
fd memory budget api --json
fd memory suggest api
```

Um projeto é nomeado pelo id ou pelo nome. `--host <nome>` lê um host pareado.

- `list <projeto>` imprime uma linha por arquivo: seu nome, seu hash, seu tamanho em bytes e linhas, se o índice
  (`MEMORY.md`) o cita, e seu tipo e descrição quando tem. Um projeto sem pasta de memória imprime
  `no memory folder: <pasta>`, e uma pasta sem arquivo imprime `no memory files in <pasta>`; ambos saem com `0`.
- `read <projeto> <nome>` imprime a identidade do arquivo, depois `hash: <hash>`, uma linha em branco e o conteúdo. O
  hash é o que uma mudança posterior do arquivo repete para provar que leu a versão atual. Um nome que não é um nome
  de arquivo simples, ou um arquivo que não existe, sai com `1` e o texto do host.
- `budget <projeto>` imprime o que a memória custa no início de uma sessão: os tokens, o índice contra seus limites
  (linhas e bytes), quanto dele carrega e o que o cortou (`lines` ou `bytes`), e as linhas e arquivos deixados de
  fora. Um índice que cabe imprime `all of it`.
- `suggest <projeto>` imprime as limpezas que a tela de Memória propõe, uma por linha: o tipo (`duplicate`,
  `broken-link`, `orphan`, `stale` ou `contradiction`), os arquivos e um detalhe quando há. Nenhuma sugestão imprime
  `no suggestions`.

Com `--json` cada verbo imprime um valor JSON com todas as chaves, e `null` no que um arquivo ou uma sugestão não tem
(`type`, `description`, `detail`). O texto que uma sessão ou uma pessoa escreveu num arquivo é impresso com os
caracteres de controle trocados, então não pode comandar o terminal. O código de saída é `0` para feito, `1` para
recusado e `2` quando nenhum daemon responde.

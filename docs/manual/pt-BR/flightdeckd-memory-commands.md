# Comandos do flightdeckd: a memória automática de um projeto

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-memory-commands.md)

Os verbos que leem e mudam a memória automática do Claude Code de um projeto: a pasta de notas que o Claude guarda
para ele e carrega no início de uma sessão. Funcionam como os outros comandos do `flightdeckd`: veja
[o que todos têm em comum](flightdeckd-commands.md#o-que-todos-têm-em-comum). `list`, `read`, `budget` e `suggest` não
mudam nada; `write` e `delete` mudam uma nota. A tela do próprio app está em
[Memória, contexto e plugins](memory-context-and-plugins.md).

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

## Mudar uma nota

```sh
fd memory write api tdd.md --file next.md --expected-hash <hash> --confirm
fd memory write api notes.md --file - --new --confirm < notes.md
fd memory delete api tdd.md --expected-hash <hash> --confirm
```

- `write <projeto> <nome> --file <caminho> --expected-hash <hash> --confirm` troca uma nota pelo conteúdo de um
  arquivo, ou da entrada padrão quando o caminho é `-`. O hash é o que `list` ou `read` imprimiu: o host recusa a
  escrita com `memory_changed` se a nota não for mais essa versão, então você nunca sobrescreve uma mudança que não
  leu. `--new` toma o lugar do hash para uma nota que não pode existir ainda, e o host a recusa com `memory_exists`
  se ela existe. Imprime `wrote <nome>  hash: <novo hash>`.
- `delete <projeto> <nome> --expected-hash <hash> --confirm` apaga uma nota e imprime `deleted <nome>`. Uma nota que
  não existe é `memory_not_found`, e uma que mudou é `memory_changed`.
- `--confirm` é obrigatório: sem ele nada é enviado. Um nome que não é um nome de arquivo simples, ou que é um link, é
  recusado pelo host (`memory_name_invalid`, `memory_is_link`) com saída `1`.

Uma escrita que não recebe resposta sai com `2` e diz que a nota pode ou não ter mudado: rode `memory read` antes de
repetir. Com `--json` uma escrita imprime `{ "name", "hash" }` e uma exclusão imprime `{ "name" }`. No shell de uma
sessão, `write` e `delete` são comandos de risco alto: o app pergunta à pessoa antes, porque toda sessão seguinte do
projeto carrega a nota como memória sua. `--confirm` e `--expected-hash` são palavras digitadas por quem roda o
comando, então não valem pela pessoa.

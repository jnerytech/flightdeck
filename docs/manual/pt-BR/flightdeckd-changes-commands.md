# Comandos do flightdeckd: as mudanças de uma sessão, de um cartão, de um terminal ou de um projeto

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-changes-commands.md)

Os verbos que leem o que uma sessão, um cartão, um terminal ou um projeto mudou no seu checkout, e os que revertem um arquivo, fazem commit e abrem um pull request. Funcionam como os
outros comandos do `flightdeckd`: veja [o que todos têm em comum](flightdeckd-commands.md#o-que-todos-têm-em-comum).
As leituras não mudam nada. As escritas exigem `--confirm`.

## fd changes

```sh
fd changes get session:3f9c1a
fd changes get card:card-1 --json
fd changes sessions /home/eu/api/src/parser.ts
fd changes watch card:card-1
```

Um alvo é `session:<id>`, `card:<id>`, `terminal:<id>` ou `project:<id>`; qualquer outra coisa é recusada com saída
`1` antes de o daemon ser consultado.

`get <alvo>` imprime onde estão as mudanças (a pasta de topo do checkout), o branch com o qual são comparadas e, para
um cartão, quantos commits ele está à frente e atrás dele, o endereço para onde um pull request seria enviado, os hooks
de commit que um commit executaria, e depois uma linha para cada arquivo alterado: seu estado, suas contagens, se ainda
não foi commitado e o digest do seu conteúdo. Um arquivo que pode conter uma credencial, e um arquivo acima do limite
de tamanho do daemon, são listados sem linhas e sem contagens, como no app. Sem mudanças imprime `no changes`.

`sessions <arquivo>` recebe o caminho absoluto de um arquivo e imprime as sessões que o escreveram: quantas edições cada
uma fez, quando foram a primeira e a última, e o título da sessão.

`watch <alvo>` imprime a mesma lista do `get`, em uma linha, cada vez que as mudanças se movem, até Ctrl-C.

Com `--json` os comandos imprimem o valor que o daemon devolve, com `null` para um campo ausente e as linhas de cada
diff em `get` e `watch`. `--host <nome>` lê um host pareado.

## Reverter, fazer commit e abrir um pull request

```sh
fd changes revert session:3f9c1a /home/me/api/src/parser.ts --confirm
fd changes undo-revert session:3f9c1a /home/me/api/src/parser.ts --confirm
fd changes commit session:3f9c1a --branch fix-parser --message "Corrige o parser" --digest src/parser.ts=9a1f... --confirm
fd changes pr session:3f9c1a --title "Corrige o parser" --remote git@github.com:me/api.git --confirm
```

Todos exigem `--confirm`; sem ele o comando é recusado com saída `1` e nada muda.

`revert <alvo> <arquivo>` descarta as mudanças de um arquivo. Imprime o comando que as desfaz e até quando:
`undo-revert <alvo> <arquivo>` devolve o arquivo enquanto o daemon ainda o guarda. Os dois exigem uma conexão próxima (este computador ou a Tailscale) quando o arquivo conduz uma sessão (dentro de qualquer pasta `.claude`, ou um `CLAUDE.md` ou `CLAUDE.local.md`, seja qual for a grafia ou o link do caminho), pois ele pode declarar hooks que rodam em toda sessão: por uma distante o daemon recusa com `transport_refused`. Qualquer outro arquivo responde de qualquer lugar.

`commit <alvo>` faz commit dos arquivos que você nomeia em um branch novo. Cada `--digest <caminho>=<digest>` é o digest
que o `get` imprimiu para aquele arquivo, então o commit tem o que você leu: um arquivo que mudou depois é recusado.
Imprime o commit, o branch e os arquivos.

`pr <alvo>` envia o branch para o endereço que o `get` imprimiu como remoto e abre um pull request com o título e, se
você der um, o corpo. Imprime o endereço do pull request. Um host alcançado por um endereço que não chega ao cofre
recusa `commit` e `pr` com saída `1`.

Se a conexão cair depois que o pedido saiu, o comando diz que a mudança pode ou não ter acontecido e sai com `2`: rode
`get` antes de tentar de novo.

O shell de uma sessão não roda `commit`, `pr` nem `revert` sem a pessoa aprovar no app.

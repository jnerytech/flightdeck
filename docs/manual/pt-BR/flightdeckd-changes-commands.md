# Comandos do flightdeckd: as mudanças de uma sessão, de um cartão, de um terminal ou de um projeto

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-changes-commands.md)

Os verbos que leem o que uma sessão, um cartão, um terminal ou um projeto mudou no seu checkout. Funcionam como os
outros comandos do `flightdeckd`: veja [o que todos têm em comum](flightdeckd-commands.md#o-que-todos-têm-em-comum).
Não mudam nada. Reverter um arquivo, fazer commit e abrir um pull request continuam no app por enquanto.

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

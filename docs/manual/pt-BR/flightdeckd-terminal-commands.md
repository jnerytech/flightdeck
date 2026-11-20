# Comandos do flightdeckd: terminais

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-terminal-commands.md)

O verbo que lê os terminais que um host mantém. Funciona como os outros comandos do `flightdeckd`: veja
[o que todos têm em comum](flightdeckd-commands.md#o-que-todos-têm-em-comum).

## fd terminal

```sh
fd terminal list
fd terminal list --json
```

`list` imprime os terminais do daemon, um por linha: id, o programa que roda, a pasta, o tamanho em colunas e
linhas, `running` ou `exited <código>`, quantas janelas o acompanham e quando começou. Um terminal aberto pelo botão
"Claude aqui" mostra também o id do `launch`. O programa aparece sem os argumentos. Sem terminal, o comando avisa e
sai com `0`. Com `--json` imprime `{"terminals": [...]}`, como o daemon devolve, com `null` para um campo ausente.
`--host <nome>` lê um host pareado. O verbo não abre, não lê e não escreve em nenhum terminal.

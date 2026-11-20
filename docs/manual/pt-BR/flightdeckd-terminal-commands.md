# Comandos do flightdeckd: terminais

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-terminal-commands.md)

Os verbos que leem e gerenciam os terminais que um host mantém. Funciona como os outros comandos do `flightdeckd`: veja
[o que todos têm em comum](flightdeckd-commands.md#o-que-todos-têm-em-comum).

## fd terminal

```sh
fd terminal list
fd terminal list --json
fd terminal open --cwd /home/pi/app
fd terminal open --cwd /home/pi/app --cols 120 --rows 40 -- bash -lc "ls -la"
fd terminal open --cwd /home/pi/app --claude --resume <id> --persona <persona>
fd terminal open-session --session fd-qa
fd terminal close <terminal> --kill
fd terminal settings --enable --confirm
fd terminal settings --disable
```

`list` imprime os terminais do daemon, um por linha: id, o programa que roda, a pasta, o tamanho em colunas e
linhas, `running` ou `exited <código>`, quantas janelas o acompanham e quando começou. Um terminal aberto pelo botão
"Claude aqui" mostra também o id do `launch`. O programa aparece sem os argumentos. Sem terminal, o comando avisa e
sai com `0`. Com `--json` imprime `{"terminals": [...]}`, como o daemon devolve, com `null` para um campo ausente.
`--host <nome>` lê um host pareado. O verbo não abre nenhum terminal e não lê a saída de nenhum.

`open` inicia um terminal no host, na pasta que você indica (ela precisa estar sob uma raiz permitida), e imprime
`opened` e a linha do terminal. Sem mais palavras, roda o shell do host. Depois de `--` vêm um programa e seus
argumentos, que rodam como estão, sem passar por um shell. `--claude` roda o Claude Code na pasta, retomando uma
sessão com `--resume` e usando uma persona com `--persona`; não vale junto com um programa. O tamanho é 80x24, a menos
que você dê `--cols` (até 500) e `--rows` (até 300). `open-session` abre um shell na pasta que o host guarda para uma
sessão, indicada pelo nome ou pelo id.

`close <terminal> --kill` pede ao host que encerre o processo de um terminal e imprime `kill sent to`; o processo ainda pode estar rodando um instante depois. Sem `--kill`, só remove um terminal que já tinha terminado, e sai com `1` quando o terminal ainda está rodando, porque soltar um terminal é da janela do app. Um terminal continua rodando depois do comando
que o abriu, então é no `list` que você o encontra de novo. `settings` liga ou desliga os terminais do host e imprime
se estão ligados, quantos podem rodar ao mesmo tempo e qual shell usam. Ligá-los dá um shell completo no host a quem
alcançar o daemon, por isso exige `--confirm`; sem ele o comando sai com `1` e não envia nada. Um host com os
terminais desligados recusa o `open`.

Se uma escrita não recebe resposta, o comando sai com `2` e avisa que um terminal pode ou não ter mudado: rode `list`
antes de tentar de novo. Ler o que um terminal imprime e digitar nele continuam no app.

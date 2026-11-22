# Comandos do flightdeckd: as chaves de um host

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-host-commands.md)

Os verbos que mudam o comportamento de um host, como a página do host no app. Um `fd host` sozinho continua só
lendo: veja [fd host](flightdeckd-commands.md#fd-host). Funcionam como os outros comandos do `flightdeckd`: veja
[o que todos têm em comum](flightdeckd-commands.md#o-que-todos-têm-em-comum). Cada um imprime o que o host guarda
agora, então um script lê o resultado e não o próprio pedido.

## fd host sleep

```sh
fd host sleep 30
fd host sleep 0
fd --host pi host sleep 30 --json
```

Define depois de quantos minutos as sessões ociosas dormem, de `0` a `1440`; `0` desliga. Imprime
`sleep  idle sessions sleep after 30 minutes`, ou `sleep  off`. Um número que não seja só dígitos nessa faixa é
recusado antes de enviar qualquer coisa.

## fd host keep-awake, pause e updates

```sh
fd host keep-awake on
fd host pause on
fd host updates off
```

Cada um aceita `on` ou `off`, e nada mais.

- **`keep-awake`:** impede o computador de dormir enquanto há sessões rodando. Imprime `keep-awake  on  held (systemd-inhibit)`,
  ou `not held (<motivo>)` quando o host não conseguiu segurar, ou `keep-awake  off`. Um host sem o recurso recusa, saída `1`.
- **`pause`:** faz os cartões novos esperarem. Imprime `pause  on  (2 sessions still running)` ou `pause  off`.
- **`updates`:** a atualização automática do daemon. Imprime `updates  automatic on  (current)`, com o estado da
  atualização, ou `updates  automatic off`. Ligar deixa o daemon instalar uma versão nova e reiniciar sozinho, por
  isso as regras de risco de uma sessão tratam `fd host updates on` como alto.

## fd host bypass

```sh
fd host bypass off
fd host bypass on --confirm
```

Se as sessões do host podem rodar sem pedidos de permissão. Imprime `bypass permissions  allowed` ou
`bypass permissions  not allowed`.

- **`off`** não pede mais nada.
- **`on`** pede `--confirm`, a sua própria palavra de que você quer isso. Sem ela o daemon recusa e o comando sai com
  `1`. Um host com um dispositivo cadastrado também pede a assinatura desse dispositivo, que um terminal não dá: o
  comando sai com `1` e diz para ligar no app. Nada é assinado nem repetido.
- Uma sessão que roda `fd host bypass on` é barrada pelas regras de risco (alto); `off` não é.

## fd ui set

```sh
fd ui set --mode simple --confirm
fd ui set --lock --confirm
fd ui set --mode full --unlock --confirm --json
```

Como o host se apresenta a quem usa o app dele: o modo em que ele começa (`full` ou `simple`) e se a troca entre os
dois está travada. Imprime `mode simple, locked yes`; `--json` imprime `{"mode":"simple","locked":true}`.

- Dê pelo menos um de `--mode full|simple`, `--lock` e `--unlock`. O que você não der fica como o host tem. `--lock`
  com `--unlock`, um modo que não seja `full` nem `simple`, ou nenhum dos três é recusado e sai com `1`.
- `--confirm` é a sua própria palavra de que você quer isso. Sem ela nada é enviado e o comando sai com `1`.
- Pergunta só ao daemon desta máquina: `--host` não vale aqui.
- Uma sessão que roda `fd ui set` é barrada pelas regras de risco (alto): ela poderia trancar a pessoa fora do modo em
  que trabalha. É seguro repetir, pois ele define e não alterna.

## Flags e códigos de saída

`--host <nome>` e `--json` valem para todos os verbos menos `fd ui set`, que não tem `--host`, e `--config <arquivo>` como nos outros comandos. `--confirm`
vale só com `bypass on` e `ui set`. Uma conexão que cai com um verbo em andamento sai com `2` e diz que a configuração pode ou
não ter mudado: todo verbo daqui é seguro de repetir. Códigos de saída: `0` feito, `1` recusado, `2` sem daemon.

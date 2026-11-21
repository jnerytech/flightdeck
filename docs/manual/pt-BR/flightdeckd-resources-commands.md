# Comandos do flightdeckd: o que o trabalho do host custa a ele

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-resources-commands.md)

Os verbos que leem os recursos do host, como o painel de Recursos os mostra, e mudam a trava de memória ou encerram um órfão. Funcionam como os outros comandos do
`flightdeckd`: veja [o que todos têm em comum](flightdeckd-commands.md#o-que-todos-têm-em-comum).

## fd resources

```sh
fd resources
fd resources --json
fd --host pi resources
```

Só lê, não muda nada.

- **Linhas:** `memory` e `disk` (`6000 of 8000 MiB used (75%)`, ou `not read`), `load` (a carga de um minuto por
  núcleo, em %) e `pause`: `new cards wait from 80% of memory`, com `(holding now)` enquanto o host os mantém
  esperando, ou `off`.
- **Depois, uma linha por sessão e por terminal:** tipo, id, nome, memória residente, CPU, quantos processos e os
  nomes dos executáveis. Depois delas, uma linha por processo órfão: `orphan  pid 4242  start-ticks 987654  node ...`.
  O pid e os start ticks são o que encerrar um órfão vai pedir.
- **Um host que não mede processos** (fora do Linux) diz `processes not measured on this platform`.
- **`--json`:** a resposta inteira do daemon, com `null` na parcela de pausa e `false` na retenção quando um host
  antigo não as envia.

Os códigos de saída são os dos outros comandos: `0` feito, `1` recusado, `2` sem daemon.

## fd resources pause-at

```sh
fd resources pause-at 0.8
fd resources pause-at off
```

Define a parcela de memória a partir da qual os cartões novos esperam: um número de `0` a `1` só com dígitos, ou
`off`. Imprime a trava como a leitura: `pause  new cards wait from 80% of memory`, ou `pause  off`.

## fd resources end-orphan

```sh
fd resources end-orphan 4242 987654
```

Encerra o processo órfão que a leitura imprimiu, pelos dois números da linha dele: o pid e os start ticks. O daemon
só o encerra enquanto esse pid ainda tiver esses start ticks e ainda for filho do daemon, então um processo que pegou
o pid depois que o órfão acabou nunca é atingido; um processo que já não é órfão do daemon é recusado, saída `1`. Imprime `ended  pid 4242`. Uma sessão
que o rode é barrada pelas regras de risco (alto).

`--host`, `--json` e os códigos de saída são os da leitura. Uma conexão que cai no meio sai com `2` e diz que a
mudança pode ou não ter acontecido; leia `fd resources` para ver.

# Comandos do flightdeckd: o que o trabalho do host custa a ele

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-resources-commands.md)

O verbo que lê os recursos do host, como o painel de Recursos os mostra. Funciona como os outros comandos do
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

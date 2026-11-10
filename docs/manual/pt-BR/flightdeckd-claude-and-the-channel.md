# flightdeckd claude e o canal

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-claude-and-the-channel.md)

## Como funciona

```sh
flightdeckd claude [argumentos do claude]
# sugestão: alias fd="flightdeckd claude"
```

`flightdeckd claude` (alias sugerido `fd`) abre o `claude` de verdade no mesmo terminal, com os
mesmos argumentos e o mesmo código de saída, e acrescenta o canal do Flightdeck. O canal é um
servidor MCP (`flightdeckd channel`) que deixa o app mandar mensagens para essa sessão como se
você as digitasse.

- **Argumentos:** o wrapper acrescenta `--mcp-config` (arquivo temporário) e
  `--dangerously-load-development-channels server:flightdeck` e define `FLIGHTDECK_LAUNCH_ID`. O
  `.mcp.json` do projeto não é tocado.
- **Config:** como os argumentos são todos do `claude`, a config do daemon vem de
  `FLIGHTDECK_CONFIG`, ou do caminho padrão.
- **Sem `claude` no PATH** (nem em `claude.executablePath`): avisa e sai.
- **Sem o daemon:** avisa e abre o `claude` assim mesmo, sem canal.
- **Com `-p` ou `--print`:** abre o `claude` normal, sem canal e sem aviso. O modo print ignora o
  canal de desenvolvimento.
- **Research preview:** o canal é um recurso de pré-visualização do Claude Code. Cada abertura
  mostra um aviso de canal de desenvolvimento, que precisa ser aceito.
- **Aviso conhecido:** na abertura, o Claude Code mostra
  `server:flightdeck · no MCP server configured with that name`, mesmo com o canal funcionando. O
  aviso é avaliado antes dos servidores do `--mcp-config` e pode ser ignorado.

| | `claude` puro | `flightdeckd claude` |
| --- | --- | --- |
| aparece na lista, com estado ao vivo | sim (com hooks) | sim (com hooks) |
| aprovar e negar pelo app | sim | sim |
| transcript ao vivo | sim | sim |
| mandar mensagem pelo app | não | sim (selo "controlável") |

## Por que a extensão do VS Code fica de fora

A extensão do Claude Code para VS Code e o app Claude Desktop rodam o `claude` em modo SDK, que
ignora o canal de desenvolvimento. Na prova de conceito, o canal subiu como MCP dentro da
extensão, mas nenhuma mensagem chegou. O terminal integrado do VS Code é um terminal comum: lá,
`flightdeckd claude` funciona.

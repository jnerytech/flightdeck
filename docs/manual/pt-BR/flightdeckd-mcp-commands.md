# Comandos do flightdeckd: os servidores MCP de um projeto

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-mcp-commands.md)

Os verbos que leem os servidores MCP que valem para um projeto e o estado que cada um informa em uma sessão ativa.
Funcionam como os outros comandos do `flightdeckd`: veja [o que todos têm em comum](flightdeckd-commands.md#o-que-todos-têm-em-comum).
Não mudam nada e não iniciam nada. Salvar, remover e ligar ou desligar um servidor continuam no app.

## fd mcp

```sh
fd mcp list api
fd mcp list api --json
fd mcp status 5b1c0e
fd mcp test api files
```

`fd mcp` sem verbo não é um destes: ele inicia o servidor MCP que o Claude Code abre neste host, pela entrada e saída
padrão, como sempre fez. Um verbo é a palavra logo depois de `mcp`.

`list <projeto>` imprime os servidores de um projeto, nomeado pelo nome ou pelo id, uma linha cada: o nome, de onde vem
(`project` para o `.mcp.json` do projeto, `user` ou `user-project` para o seu arquivo), o transporte, `on` ou `off`,
`editable` ou `read-only`, o comando ou o link que ele executa e os nomes dos seus segredos (nunca os valores). Um nome
que dois projetos compartilham é recusado com os ids deles. Um projeto sem servidores imprime `no MCP servers`.

`status <sessão>` imprime o estado que cada servidor informa em uma sessão gerenciada ativa, nomeada pelo id:
`connected`, `failed`, `needs-auth`, `pending` ou `disabled`, e o erro dele quando houver. Uma sessão que o host não
conhece é recusada com saída `1`.

`test <projeto> <servidor>` imprime o comando (ou link) exato que um teste do servidor executaria, e não inicia nada.

Com `--json` os comandos imprimem um valor JSON com `null` para um campo ausente. O daemon já mascara ali os segredos de
um servidor. O texto e o JSON imprimem os argumentos de um comando por inteiro, então um segredo vai em uma variável,
não em um argumento. `--host <nome>` lê um host pareado.

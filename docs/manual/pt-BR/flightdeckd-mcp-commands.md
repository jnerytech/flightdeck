# Comandos do flightdeckd: os servidores MCP de um projeto

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-mcp-commands.md)

Os verbos que leem os servidores MCP que valem para um projeto e o estado que cada um informa em uma sessão ativa, e
os que testam (iniciam), salvam, removem ou ligam e desligam um servidor. Funcionam como os outros comandos do
`flightdeckd`: veja [o que todos têm em comum](flightdeckd-commands.md#o-que-todos-têm-em-comum).

## fd mcp

```sh
fd mcp list api
fd mcp list api --json
fd mcp status 5b1c0e
fd mcp test api files
fd mcp test api files --confirm
fd mcp save api server.json --confirm
cat server.json | fd mcp save api - --confirm
fd mcp remove api files --confirm
fd mcp toggle api files --disable
fd mcp toggle api files --enable --confirm --session 5b1c0e
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
Com `--confirm` ele inicia o servidor, como o botão Testar do app, e imprime as ferramentas e os recursos que ele
oferece (`tools: a, b`, `resources: none`). Leia antes a prévia: o servidor é um comando do `.mcp.json` do projeto. Iniciá-lo exige uma conexão próxima (este
computador ou a Tailscale): por uma conexão distante o daemon recusa o `--confirm`. A prévia responde em qualquer lugar.

`save <projeto> <arquivo> --confirm` adiciona um servidor ao `.mcp.json` do projeto, ou troca o de mesmo nome, e imprime
os servidores. O arquivo é JSON (`-` lê da entrada padrão) com os campos de um servidor: `name`, e `type` (`stdio`,
`http` ou `sse`), `command`, `args`, `env`, `url` e `headers`. Um campo que ele não conhece é recusado, para que um erro
de digitação não salve um servidor que não executa nada. Os segredos vão no arquivo, nunca na linha de comando, onde o
histórico do shell e a lista de processos os guardariam; as mensagens nomeiam um campo mas nunca imprimem um valor. Um
valor que aparece como `••••••` (copiado de `list`) é recusado: digite o real. Exige `--confirm`, pois o servidor é um
comando que o host vai executar.

`remove <projeto> <servidor> --confirm` apaga o servidor desse arquivo e imprime os servidores que sobraram. Exige
`--confirm`.

`toggle <projeto> <servidor> --enable | --disable` liga ou desliga um servidor para as próximas sessões do projeto e
imprime os servidores. `--enable` deixa o servidor rodar, então exige `--confirm`; `--disable` só o para e não aceita
`--confirm`. `--session <id>` atualiza também essa sessão ativa. Um servidor do seu arquivo de usuário (`read-only`) é
recusado.

Se o host não responder a um `save`, a um `remove` ou a um `toggle`, o resultado é desconhecido: o comando sai com `2` e manda rodar
`mcp list` antes de tentar de novo. O shell de uma sessão não os usa como a pessoa usaria: `--confirm` é só uma palavra
que quem chama digita, então a checagem de permissão trata `save`, `remove`, `test --confirm`, `toggle --enable` e tudo que não
é uma leitura simples como risco alto e pergunta a você.

Com `--json` os comandos imprimem um valor JSON com `null` para um campo ausente. O daemon já mascara ali os segredos de
um servidor. O texto e o JSON imprimem os argumentos de um comando e um link por inteiro, então um segredo vai em uma variável ou
em um header, não em um argumento nem em um link. As linhas de texto separam os campos com dois espaços e um nome pode
tê-los: um script lê o `--json`. `--host <nome>` lê um host pareado.

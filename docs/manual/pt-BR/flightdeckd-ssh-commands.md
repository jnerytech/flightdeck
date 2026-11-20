# Comandos do flightdeckd: destinos ssh

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-ssh-commands.md)

Os verbos que leem os destinos ssh de um host. Funcionam como os outros comandos do `flightdeckd`: veja
[o que todos têm em comum](flightdeckd-commands.md#o-que-todos-têm-em-comum).

## fd ssh

```sh
fd ssh list
fd ssh list --json
fd ssh import preview
fd ssh hostkey check prod
fd ssh test prod
```

`list` imprime os destinos do daemon, um por linha: nome, id, `usuário@host:porta`, como entra (`agent`,
`key-file`, `vault-key` ou `password`) e a impressão digital da chave do servidor que ele fixa, ou `not pinned`
antes da primeira confirmação. Um destino que passa por outro host, por um destino de salto, por um item do cofre
ou que tem etiquetas mostra isso depois. O item do cofre aparece pelo id; um segredo nunca é impresso.
`import preview` imprime os nomes do `~/.ssh/config` que a importação do app transformaria em destinos e marca os
que já estão cadastrados. Não grava nada. Sem destino, ou sem host no arquivo, o comando avisa e sai com `0`. Com
`--json` os comandos imprimem `{"targets": [...]}` e `{"entries": [...]}`, como o daemon devolve, com `null` para
um campo ausente. `--host <nome>` lê um host pareado. `list` e `import preview` não se conectam a nenhum servidor.

`hostkey check <destino>` e `test <destino>` indicam um destino pelo nome ou pelo id e fazem o daemon se conectar a
ele. `hostkey check` lê a chave do servidor e compara com a fixada: imprime `host key pinned`,
`host key not pinned yet` ou `host key CHANGED` com as impressões digitais, e sai com `0` só quando a chave está
fixada e confere. `test` entra sem terminal e imprime `reachable`, ou `failed` com o motivo, e sai com `0` só
quando o login funciona. Nenhum fixa chave nem muda um destino: confirmar uma chave continua no app. Um destino
que entra com chave do cofre não pode ser testado de um terminal, porque o terminal nunca envia a chave: o comando
avisa e sai com `1`. Um nome que dois destinos têm é recusado com os ids. Esses dois esperam até um minuto pelo
servidor.

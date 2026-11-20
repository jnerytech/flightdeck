# Comandos do flightdeckd: destinos ssh

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-ssh-commands.md)

Os verbos que leem os destinos ssh de um host. Funcionam como os outros comandos do `flightdeckd`: veja
[o que todos têm em comum](flightdeckd-commands.md#o-que-todos-têm-em-comum).

## fd ssh

```sh
fd ssh list
fd ssh list --json
fd ssh import preview
```

`list` imprime os destinos do daemon, um por linha: nome, id, `usuário@host:porta`, como entra (`agent`,
`key-file`, `vault-key` ou `password`) e a impressão digital da chave do servidor que ele fixa, ou `not pinned`
antes da primeira confirmação. Um destino que passa por outro host, por um destino de salto, por um item do cofre
ou que tem etiquetas mostra isso depois. O item do cofre aparece pelo id; um segredo nunca é impresso.
`import preview` imprime os nomes do `~/.ssh/config` que a importação do app transformaria em destinos e marca os
que já estão cadastrados. Não grava nada. Sem destino, ou sem host no arquivo, o comando avisa e sai com `0`. Com
`--json` os comandos imprimem `{"targets": [...]}` e `{"entries": [...]}`, como o daemon devolve, com `null` para
um campo ausente. `--host <nome>` lê um host pareado. Esses verbos não se conectam a nenhum servidor.

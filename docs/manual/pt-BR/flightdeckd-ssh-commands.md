# Comandos do flightdeckd: destinos ssh

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-ssh-commands.md)

Os verbos que leem, testam, adicionam, editam, fixam as chaves, removem e importam os destinos ssh de um host. Funcionam como os outros comandos do `flightdeckd`: veja
[o que todos têm em comum](flightdeckd-commands.md#o-que-todos-têm-em-comum).

## fd ssh

```sh
fd ssh list
fd ssh list --json
fd ssh import preview
fd ssh hostkey check prod
fd ssh test prod
fd ssh hostkey confirm prod --fingerprint SHA256:...
fd ssh hostkey forget prod
fd ssh add web --address web.internal --user deploy --port 2222 --jump prod
fd ssh edit web --address web2.internal
fd ssh edit web --no-jump --auth agent
fd ssh edit web --forward-agent --confirm
fd ssh remove prod --confirm
fd ssh import apply --alias staging --alias prod
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
quando o login funciona. Nenhum fixa chave nem muda um destino. Um destino
que entra com chave do cofre não pode ser testado de um terminal, porque o terminal nunca envia a chave: o comando
avisa e sai com `1`. Um nome que dois destinos têm é recusado com os ids. Esses dois esperam até um minuto pelo
servidor.

`hostkey confirm <destino> --fingerprint <SHA256:...>` fixa a chave do servidor de um destino. Rode `hostkey check`
antes, leia a impressão digital que ele mostra e compare com a que você confia, depois digite-a. O comando consulta
o servidor de novo e só fixa a chave quando a impressão digital digitada é a que o servidor mostra agora; senão não
fixa nada e sai com `1`. Um destino cuja chave já está fixada, ou cuja chave mudou, é recusado: rode
`hostkey forget <destino>` antes, que desfixa a chave, e confirme de novo. `forget` não fixa nada e recebe só o
destino. Um agente que roda isso do próprio shell precisa de confirmação, como nos outros comandos que decidem em
que um host confia.

`remove <destino> --confirm` apaga um destino. Sem `--confirm` ele recusa e não envia nada. Um destino pelo qual outro
passa como salto é recusado pelo daemon: remova o outro antes.

`import apply --alias <nome>...` transforma os hosts nomeados do `~/.ssh/config` em destinos; leia `import preview`
antes e nomeie só os que você quer, no mínimo um e no máximo 500. Imprime uma linha por nome, `imported as <id>` ou
`skipped` com o motivo, e sai com `1` quando algum nome foi pulado (já existe, não está no arquivo, ou os saltos
formam um ciclo). Um host com `IdentityFile` vira um destino de chave em arquivo que usa esse caminho. Um agente que
roda `add`, `edit`, `remove` ou `import apply` do próprio shell precisa de confirmação.

`add <nome> --address <host> --user <nome>` cria um destino e imprime `<nome>: added as <id>`. Opcionais: `--port`
(1 a 65535), `--auth agent|key-file|vault-key|password`, `--secret-ref <caminho da chave ou nome do item do cofre>` (um nome, nunca o segredo em si; o agente não tem) e `--jump <destino>`,
o destino pelo qual ele passa (um nome ou um id). Recusa um nome que já existe e aponta para `edit`.
`edit <destino>` muda os campos que você nomeia e mantém o resto; exige ao menos um entre `--address`, `--user`,
`--port`, `--auth`, `--secret-ref`, `--jump`, `--no-jump`, `--forward-agent` e `--no-forward-agent`. Um `--auth` novo
esquece a referência de chave antiga, a menos que você passe `--secret-ref` junto. Mudar o endereço ou a porta limpa
a chave de host fixada; o comando avisa, e você roda `hostkey check` e `hostkey confirm` de novo. `--forward-agent`
deixa o host remoto usar o seu agente ssh, então exige `--confirm` e uma conexão próxima (este computador ou a Tailscale): por uma distante o daemon recusa. `--no-forward-agent` e uma edição sem ele respondem de qualquer lugar. Tags, um host pelo qual passar, redirecionamentos
locais e renomear continuam no app.

# Comandos do flightdeckd: os arquivos de um repositório e as pastas de um host

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-file-commands.md)

Os verbos que leem os arquivos do repositório em que uma sessão, um cartão, um terminal ou um projeto trabalha, e as
pastas e arquivos de um host. Funcionam como os outros comandos do `flightdeckd`: veja
[o que todos têm em comum](flightdeckd-commands.md#o-que-todos-têm-em-comum). Todos, menos `write`, não mudam nada.

## fd file

```sh
fd file list card:card-1 --dir src
fd file read card:card-1 src/parser.ts
fd file search card:card-1 --mode content --query "TODO"
fd file search card:card-1 --mode name --query env --limit 20
fd file write card:card-1 src/parser.ts --file next.ts --hash <hash> --confirm
fd file dirs /home/me
fd file files /home/me/api --hidden
```

Um alvo é `session:<id>`, `card:<id>`, `terminal:<id>` ou `project:<id>`; qualquer outra coisa é recusada com saída `1`
antes de o daemon ser consultado.

`list <alvo>` imprime as pastas e os arquivos de uma pasta do repositório: a raiz, ou a que `--dir` indica. Uma pasta
termina com `/`. Um arquivo que pode guardar uma credencial aparece pelo nome, marcado, e nunca é lido.

`read <alvo> <arquivo>` imprime o tamanho e o hash do arquivo e depois o texto, uma linha por vez. Um arquivo acima de
1 MB, um arquivo binário e um arquivo que pode guardar uma credencial são recusados com saída `1` e o motivo do
daemon, sem imprimir conteúdo. O comando imprime o arquivo inteiro: não há opção de tamanho. Na saída em texto, uma
tabulação ou outro caractere de controle vira um espaço; `--json` imprime o texto como o host o tem, exceto DEL, os caracteres C1 e os de largura zero (uma marca de ordem de bytes entre eles), que também viram espaços ali, então o texto pode diferir do que o hash cobre.

`write <alvo> <arquivo> --file <caminho|-> --hash <hash> --confirm` substitui o arquivo pelo texto de `--file`, ou da
entrada padrão para `-`, byte a byte. `--hash` é o hash que `read` imprimiu: a escrita só passa se o arquivo ainda o
tem, então um arquivo que outra pessoa mudou nesse meio tempo é recusado com saída `1` e o motivo do daemon, sem
escrever nada. Um arquivo que ainda não existe, um arquivo de credencial e um texto acima de 1 MB também são
recusados. Sem `--confirm`, `--file` ou um `--hash` de 64 dígitos, nada é enviado. Em caso de sucesso imprime o
caminho, o tamanho e o novo hash, que a próxima escrita repete; `--json` imprime `path`, `hash` e `size`. Se a conexão
fechar depois de a escrita ser enviada, o comando sai com `2` e diz que o arquivo pode ou não ter mudado: leia de novo
antes de escrever. `read` não é uma cópia para editar e devolver, pois limpa caracteres de controle do que imprime:
escreva a partir do seu próprio arquivo. O shell de uma sessão não roda `write` sem a pessoa aprovar, pois o app pede
que a pessoa abra o arquivo e salve. Escrever o que orienta uma sessão (um arquivo dentro de qualquer pasta `.claude`, como as configurações, os agentes,
as skills, os comandos e as regras, ou um `CLAUDE.md` ou `CLAUDE.local.md`, de qualquer forma que o caminho seja escrito
ou ligado) exige uma conexão próxima (este computador ou a Tailscale), pois ele pode declarar hooks que rodam em toda sessão: por uma distante o daemon recusa com
`transport_refused`. O mesmo vale para um arquivo que tem outro hard link (ele pode ser um arquivo de configuração com outro nome) e para o nome curto do `CLAUDE.local.md` que o Windows lê (`CLAUDE~1.MD`). Qualquer outro arquivo escreve de qualquer lugar.

`search <alvo> --mode name|content --query <texto>` procura arquivos pelo nome ou pelo que guardam. O texto tem de 1
a 200 caracteres e nenhum caractere de controle. `--limit` (1 a 200) limita os resultados. Cada resultado é uma linha:
o caminho e, numa busca por conteúdo, a linha e o texto. Um arquivo de credencial aparece só na busca por nome,
marcado como um arquivo cujo conteúdo não é buscado. Quando há mais resultados do que os mostrados, a última linha diz.

`dirs [<caminho>]` lista as pastas de uma pasta do host e a pasta acima dela. Sem caminho, lista as pastas que o host
permite. `files <caminho>` lista os arquivos de uma pasta. `--hidden` inclui as ocultas. Um caminho relativo é a pasta
atual desta máquina; com `--host`, o caminho é o do próprio host e precisa ser absoluto. Uma pasta fora das que o host
permite é recusada com saída `1`.

Com `--json` os comandos imprimem o valor que o daemon devolve, com `null` para um campo ausente e `false` para uma
marca `secret` não definida. `--host <nome>` lê um host pareado. Sem daemon, os comandos saem com `2`.

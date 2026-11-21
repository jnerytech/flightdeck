# Comandos do flightdeckd: modelos de tarefa e o que uma tarefa fez

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-template-commands.md)

Os verbos por trás dos modelos de tarefa do modo simples e dos modelos de harness do host: listar os modelos, iniciar
uma tarefa a partir de um, listar e ler os arquivos que uma tarefa fez, e listar ou apagar um modelo de harness salvo.
Funcionam como os outros comandos do `flightdeckd`: veja [o que todos têm em comum](flightdeckd-commands.md#o-que-todos-têm-em-comum).
Dois verbos mudam algo: `template start` inicia uma sessão e `harness templates delete` remove uma pasta do host.

## fd template

```sh
fd template list
fd template list --json
fd template start summarize --field folder=/w/docs --field tone=formal --name "Resumo dos docs"
fd template start summarize --field folder=/w/docs --language pt-BR --json
```

`list` imprime uma linha por modelo (`summarize  Summarize a folder  read_only`: o id, o título e o preset de
permissões), depois uma linha por campo abaixo dele (`  field tone  choice  formal, casual  (optional)`: o id do campo,
o tipo, as opções de uma escolha e se pode ficar de fora). Um arquivo de modelo que não carregou imprime
`problem  <arquivo>  <motivo>` depois dos modelos.

`start <modelo>` inicia uma sessão do Claude no modelo. Cada campo que o modelo pede é dado com `--field
<id>=<valor>`, uma vez por campo (um caminho para uma pasta ou um arquivo, um texto, ou o id de uma opção; o valor pode
conter `=`). `--language en|pt-BR` escolhe o idioma do prompt (padrão `en`) e `--name` dá nome à tarefa (1 a 100
caracteres). Imprime `started  <sessão>  <modo de permissão>  working <pasta>  results <pasta>`; com `--json` imprime a
resposta inteira. O daemon confere o modelo e os valores: um modelo desconhecido, um valor faltando ou uma pasta fora
das raízes permitidas é uma recusa com o texto dele e saída 1. Uma conexão perdida durante o início diz que a tarefa
pode ou não ter começado: veja `fd sessions` antes de iniciá-la de novo.

No shell de uma sessão, `template start` é classificado como alto: o app pede a confirmação da pessoa, e um shell só
digita palavras.

## fd task

```sh
fd task results docs-task
fd task results docs-task --json
fd task preview docs-task "/w/docs/Flightdeck results/summary.md"
```

Uma sessão é o id ou o nome dela. `results` imprime uma linha por arquivo que a tarefa fez ou mudou (`new  1234 B  <hora>
<caminho>`) ou `no files yet`. `preview` imprime o começo de um desses arquivos como linhas simples; o daemon recusa um
caminho que não é resultado da tarefa. Uma lista ou um texto cortado por tamanho avisa no stderr (`cut short`), e o
stdout continua sendo o que um script lê. Caracteres de controle no texto de um arquivo viram espaços. `--json` imprime
a resposta do daemon inteira. Os dois só leem.

## fd harness templates

```sh
fd harness templates list
fd harness templates delete node-api --confirm
```

`list` imprime uma linha por modelo de harness salvo: o id, o título, o número de arquivos e o tamanho em bytes
(`node-api  Node API  2 files  2048 bytes`), nunca um conteúdo, ou `no harness template on this host`.

`delete <modelo> --confirm` remove a pasta do modelo do host e imprime `deleted harness template <id>`. Sem `--confirm`
o comando recusa antes de conectar. O daemon só apaga dentro da pasta de modelos de harness e só numa conexão deste
computador: com `--host` é recusado. Uma conexão perdida durante a exclusão diz que o modelo pode ou não ter sido
apagado: liste os modelos para ver. No shell de uma sessão é classificado como alto.

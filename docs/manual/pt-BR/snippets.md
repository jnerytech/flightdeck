# Snippets

[Voltar ao manual](../pt-BR.md) · [English](../en/snippets.md)

**Snippets** são comandos e prompts salvos. A tela **Snippets** (barra lateral, para hosts que os
guardam) mostra os snippets do host; escolha um **Projeto** para somar os dele e os do
`.flightdeck/snippets.yaml` versionado, ou **Globais (deste app)** para os guardados no app.

- **Novo snippet**: nome, tipo (**Comando**, uma linha, ou **Prompt**), o texto, etiquetas e onde
  guardar (no host, no projeto, no arquivo versionado do projeto ou no app). Escreva `{{nome}}`
  para um valor pedido na hora de usar; o editor mostra os campos enquanto você digita, e cada um
  pode ter um padrão e uma lista de opções. `{{cwd}}`, `{{branch}}`, `{{file}}` e `{{selection}}`
  vêm de onde o snippet é usado.
- Um snippet nunca leva segredo: um com segredo é recusado com o motivo, e **Transformar em ação**
  abre as Ações do projeto com uma ação nova preenchida: o comando sem o segredo e uma variável de
  ambiente para ele, cujo segredo do cofre você escolhe.
- O arquivo versionado é compartilhado pelo repositório. Até você **Confiar no arquivo**, os
  comandos dele só colam, sem rodar; mudar o arquivo tira a confiança. As entradas que o app não
  consegue ler aparecem com o motivo.
- **Importar do histórico do shell** lista os comandos dos históricos de bash, zsh e PowerShell do
  host, os mais usados primeiro (só leitura). Uma linha com token, chave, senha ou um valor do cofre
  fica oculta e não pode ser importada; **Revelar linhas ocultas** mostra só as que os padrões
  acharam, ainda travadas. As linhas marcadas vão para os snippets do host ou do app, nunca para o
  arquivo versionado.
- **Importar de arquivo** lê uma lista de snippets em YAML ou JSON (o formato do arquivo versionado), mostra o que achou e o que deixou de fora e guarda os snippets no host ou no app.
- Os favoritos (a estrela) vêm primeiro, depois os usados mais recentemente. **Usar** numa linha abre o snippet para preencher e usar.

Para usar:

- **Ctrl+K**: **Snippet: <nome>** (a busca também olha etiquetas e conteúdo) abre o snippet com os
  campos. Um comando **cola no terminal** da tela (com ou sem **Enter**) ou **roda numa aba nova**
  na pasta que você der; um prompt é **enviado à sessão** da tela (gerenciada ou do terminal em que se pode escrever) ou abre uma **Nova sessão com este prompt**. **Copiar** vale para os dois.
- Numa aba de terminal, **Ctrl+Shift+Espaço** lista os snippets de comando daquele host e do app.
- Na caixa de mensagem de uma sessão, **/** lista os snippets de prompt; o escolhido entra na
  caixa preenchido com a pasta da sessão, ou como está escrito quando falta um valor.
- O Claude lê snippets pelas ferramentas `list_snippets` e `get_snippet` do MCP do Flightdeck. O
  Flightdeck nunca roda um snippet pelo Claude: um comando que o Claude roda passa pelas permissões
  do próprio Claude Code.

## Pelo shell

`flightdeckd snippet` (ou `fd snippet`) lê os snippets de um host. Funciona como os outros comandos do `flightdeckd`:
veja [o que todos têm em comum](flightdeckd-commands.md#o-que-todos-têm-em-comum).

```sh
fd snippet render review --value file=src/a.ts --value branch=dev
fd snippet render review --project-path /home/pi/app --json
fd snippet parse snippets.yaml
cat snippets.yaml | fd snippet parse - --json
fd snippet import-history --limit 20
fd snippet import-history --reveal --json
```

- `render <nome ou id>` imprime o texto que o snippet geraria, com cada `--value campo=texto` preenchido. Não cola nem
  roda nada. Um campo sem valor é recusado com o motivo do daemon e saída `1`. `--project-path` soma os snippets desse
  projeto à busca pelo nome. Controles de terminal e tabulações no texto saem como espaços; `--json` (`{"id", "name", "text", "fields"}`) mantém o texto exato, então use-o para encadear um comando.
- `parse <arquivo>` envia ao daemon o texto de uma lista YAML ou JSON e imprime uma linha por snippet lido (nome, tipo e
  etiquetas); `-` lê o texto do stdin. Não guarda nada. Uma entrada que o daemon deixou de fora aparece no stderr; um
  texto sem nenhum snippet sai com `1`. Um texto acima de 1000000 caracteres é recusado antes de ser enviado.
- `import-history` lista os comandos mais usados dos históricos de shell do host (`--limit` de 1 a 200). Uma linha com
  segredo mostra o que foi achado, nunca o valor, e não pode ser importada; `--reveal` mostra só os comandos que a
  varredura escondeu por um motivo que ela sabe nomear. Não guarda nada: importar as linhas é um verbo posterior.
- `--host <nome>` e `--json` valem como em todo lugar. `list` e `get` mantêm a saída crua própria.

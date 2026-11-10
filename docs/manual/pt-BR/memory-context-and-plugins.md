# Memória, contexto e plugins

[Voltar ao manual](../pt-BR.md) · [English](../en/memory-context-and-plugins.md)

Duas extensões da tela **Agente** do projeto (Fase 12) e uma tela para os plugins do Claude Code.

## Memória e contexto

Na tela **Agente** de um projeto, para um host que anuncia `memory`:

- **Memória** lista os arquivos da memória automática do projeto
  (`~/.claude/projects/<projeto>/memory`, a mesma para todas as worktrees do repositório): o índice
  `MEMORY.md` e um arquivo por tópico, com o tipo e uma marca para os que o índice não cita.
  **Abrir** mostra o arquivo; **Salvar** e **Apagar** sempre perguntam antes, e o salvar repete o
  hash do que foi aberto: se o arquivo mudou no disco nesse meio-tempo, nada é gravado e
  **Recarregar** traz o texto novo, mantendo o seu na tela. **Nova memória** cria um arquivo `.md`
  simples nessa pasta e em nenhum outro lugar. O Flightdeck só mexe na memória por uma ação sua
  e registra cada decisão (o nome e os hashes, nunca o texto) em `memory-decisions.jsonl`, ao lado
  dos dados do daemon.
- **Sugestões de limpeza** apontam arquivos duplicados, linhas do índice cujo arquivo sumiu,
  arquivos que o índice não cita, arquivos sem mudança há mais de 90 dias e entradas que parecem
  se contradizer. Elas só apontam: nada muda a não ser que você mude.
- **Contexto** é o orçamento da partida de uma sessão: cada fonte (o CLAUDE.md da organização, do
  usuário e do projeto, o `CLAUDE.local.md`, as regras, as skills e a memória) com uma estimativa de
  tokens (um quarto dos bytes) e se entra **na partida** ou **sob demanda**. Só as primeiras 200
  linhas ou 25 KB do `MEMORY.md` entram na partida: a tela destaca o corte e lista as linhas, e os
  arquivos que só elas citam, que ficam de fora.

## Plugins

A tela **Plugins** (barra lateral, para hosts que anunciam `plugins`) usa o comando `claude plugin`
do host. Um plugin roda código na máquina, então cada um mostra **o que instala** antes de
qualquer coisa: o manifesto, os hooks com os eventos que escutam, os monitores, as skills, os
agentes, os comandos e os servidores MCP, e um hash de todo o conteúdo. Hooks em `PreToolUse` ou
`PermissionRequest`, que podem decidir por você, ganham uma marca de **atenção**.

- **Instalados** lista os plugins com versão, escopo e estado: **Ver o que instala**,
  **Atualizar**, **Fixar versão** e **Remover**. Um plugin fixado não é atualizado até você soltar.
  **Prévia da pasta** recebe a pasta de um plugin local: o `claude plugin validate` roda antes, e
  uma pasta que ele recusa não se instala.
- **Disponíveis** lista o que os marketplaces oferecem; **Instalar** mostra o conteúdo e o hash, e a
  instalação repete esse hash. Um plugin que vem de outro repositório não tem prévia e não se
  instala por aqui.
- Um comando que o marketplace declara é mostrado, e só **Aceitar este comando** o aceita, pelo
  próprio sha256. O Flightdeck nunca passa `-y` à CLI.
- Depois de instalar ou atualizar, a pasta que a CLI deixou é conferida de novo por hash; se não
  for o conteúdo que você viu, o plugin é desinstalado na hora e a decisão fica registrada em
  `plugin-decisions.jsonl`.
- **Marketplaces** adiciona e remove (cada um depois de uma confirmação) e atualiza.

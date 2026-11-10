# Checkpoints e configuração do agente

[Voltar ao manual](../pt-BR.md) · [English](../en/checkpoints-and-agent-configuration.md)

Duas coisas da Fase 12: voltar no tempo dentro de uma sessão (a **linha do tempo**) e configurar o
agente de um projeto (a **tela Agente**). As duas precisam de um daemon que anuncie os recursos
`checkpoints` e `agentcfg` (0.12.0 ou mais novo); num daemon antigo os botões simplesmente não
aparecem.

## Snapshots

No começo e no fim de cada turno, quando a pasta da sessão está dentro de um repositório git, o
daemon tira um **snapshot**: uma cópia do HEAD mais todas as mudanças, com os arquivos não
rastreados e sem os ignorados. Ele é montado num índice temporário e guardado como um commit para o
qual só aponta `refs/flightdeck/snapshots/<sessão>/<n>`; o seu índice, os seus arquivos e o `git
status` não mudam, e nada aparece no `git log`.

- As sessões gerenciadas tiram os snapshots sozinhas. As sessões do terminal tiram pelos
  [hooks](session-hub-and-claude-code-hooks.md#hooks-do-claude-code) (`UserPromptSubmit` antes do turno, `Stop` depois), então os hooks
  precisam estar instalados.
- Um turno que muda mais de 200 MB é pulado, com o motivo. Uma pasta fora de um repositório não tem
  snapshots.
- A manutenção diária guarda 50 snapshots por sessão e 30 dias, e apaga as refs que nada mais usa.

## A linha do tempo

O botão **Linha do tempo** no cabeçalho de uma sessão (gerenciada ou do terminal) abre um painel
lateral com os turnos, do mais antigo ao mais novo. Cada turno mostra o número, a hora local, o
prompt e se mudou arquivos: **Mudou arquivos**, **Sem mudança nos arquivos** ou **Em andamento**.
**Ver arquivos do turno N** lista os arquivos que o turno mudou, com o que aconteceu com cada um
(alterado, criado, apagado) e as linhas somadas e removidas.

## Voltar arquivos

**Voltar arquivos até aqui** devolve os arquivos do repositório ao que eram antes daquele turno.

1. Abre primeiro uma prévia: os arquivos que mudam, o que acontece com cada um (volta ao que era,
   será removido porque foi criado depois, será restaurado), as linhas, e por onde volta: pelo
   checkpoint do próprio Claude Code (sessão gerenciada viva) ou pelo snapshot git do turno.
2. Nada muda até você apertar **Voltar arquivos**.
3. Antes de voltar, o Flightdeck guarda o estado de agora. **Desfazer volta** (no painel) traz tudo
   de volta.

O botão fica desligado enquanto a sessão está num turno: pare a sessão antes. Os arquivos ignorados
pelo git nunca são tocados, e só voltam arquivos de dentro do repositório.

**O que voltar arquivos não faz.** Cobre arquivos, e só arquivos. Uma mudança de banco, uma chamada
de rede, um `git push` ou qualquer outro comando que agiu fora do repositório não é desfeito. O
checkpoint do próprio SDK não enxerga o que o `Bash` ou os subagentes mudaram, e é por isso que o
Flightdeck soma os snapshots git.

## Bifurcar

**Bifurcar daqui** cria uma conversa nova que começa naquele turno; a original continua como está.
Você escolhe onde abrir:

- **Abrir no Flightdeck:** uma sessão gerenciada nova, retomada na conversa nova.
- **Abrir no terminal:** a janela mostra o comando (`flightdeckd claude --resume <id>`) e o botão do
  terminal.

**Voltar os arquivos também** devolve os arquivos ao estado daquele turno antes de abrir a
bifurcação, com a mesma prévia de cima. Dá para desfazer depois, pela linha do tempo.

Numa sessão do terminal, o daemon acha a mensagem do turno no transcript pelo prompt. Quando não
tem certeza (o mesmo prompt dito mais vezes do que há turnos, ou o contrário, ou a mensagem ainda
não foi indexada), a bifurcação fica desligada naquele turno e o painel diz por quê.

A bifurcação é gravada pelo SDK como um transcript novo em `~/.claude/projects`, como qualquer
sessão do Claude Code: a única escrita ali que vem desta fase, e só quando você pede.

## A tela Agente

**Projetos → Agente de {projeto}** abre a configuração do projeto para o Claude Code, em quatro
abas. O Flightdeck escreve só arquivos do projeto, cada vez que você aperta o botão que nomeia o
arquivo; o `~/.claude` e o `~/.claude.json` do usuário aparecem **só para leitura**.

- **MCP:** os servidores do `.mcp.json` do projeto e os do usuário (`~/.claude.json`, o geral e o
  deste projeto), cada um com a sua origem. Dá para adicionar, editar e remover os do `.mcp.json`; a
  chave de ligar e desligar grava o `.claude/settings.local.json`. O `.mcp.json` é versionado, e a
  tela avisa. Os valores de `env` e `headers` aparecem mascarados: para salvar um servidor que os
  tem, digite de novo cada valor mascarado.
- **Testar** mostra o comando e os argumentos exatos (ou a URL) e pede confirmação antes de rodar
  qualquer coisa, porque um servidor stdio é um comando que veio do repositório. Depois sobe o
  servidor, lista as ferramentas e os recursos e o derruba (limite de 15 s). Abrir a lista nunca
  sobe um servidor.
- **CLAUDE.md, Agentes e Skills:** os arquivos do projeto (um `CLAUDE.md` em qualquer pasta, o
  `CLAUDE.local.md`, `.claude/agents/*.md`, `.claude/skills/<nome>/SKILL.md`) podem ser editados,
  com prévia; os do usuário são só leitura. Salvar compara o hash lido quando o arquivo foi aberto:
  se o arquivo mudou no disco, nada é sobrescrito, o que você digitou fica na tela e **Recarregar**
  traz a versão atual. Agentes e skills têm um formulário para o frontmatter (nome, descrição, e
  ferramentas e modelo num agente) e guardam todas as outras linhas do arquivo. **Novo agente**,
  **Nova skill** e **Novo CLAUDE.md** criam o arquivo no primeiro salvamento.
- Os arquivos do projeto que não são o `CLAUDE.local.md` são versionados: a tela avisa que salvar
  muda um arquivo do repositório.

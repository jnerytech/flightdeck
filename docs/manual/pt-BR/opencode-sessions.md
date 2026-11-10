# Sessões do OpenCode

[Voltar ao manual](../pt-BR.md) · [English](../en/opencode-sessions.md)

Um host também pode rodar sessões do [OpenCode](https://opencode.ai/v2/docs/), abertas pelo app, ao
lado das do Claude Code. O Flightdeck conversa com o OpenCode pelo Agent Client Protocol
(`opencode acp`), um processo por sessão ativa. Precisa do OpenCode 2 e foi verificado com o 2.2.5;
uma versão mais nova roda, mas aparece como não verificada. O OpenCode fica desligado em todo host
até você ligá-lo.

## Ligar

1. Instale o OpenCode no host (o script de instalação dele o põe em `~/.opencode/bin`) e entre num
   provedor com o próprio `opencode auth login` do OpenCode. O Flightdeck nunca lê as credenciais do
   OpenCode.
2. Na config do host, acrescente `"opencode": { "enabled": true }`. Se o `opencode` não estiver no
   PATH do daemon nem em `~/.opencode/bin`, informe o caminho: `"opencode": { "enabled": true, "executablePath": "/caminho/do/opencode" }`.
3. Reinicie o daemon.

Ao subir, o daemon roda `opencode --version` e um canário: um `opencode.json` inofensivo numa pasta
do próprio Flightdeck não pode ser lido, o que prova que a config de projeto está desligada naquela
versão. Se algo falhar, o host lista o OpenCode como indisponível com o motivo, e o
`flightdeckd doctor` mostra isso na linha do OpenCode. Essa linha nunca reprova o doctor. No Windows e
no macOS ela acrescenta "unverified on this OS" (o doctor fala em inglês): os caminhos da config global ali ainda não
foram conferidos numa máquina real.

## Abrir uma sessão

**Nova sessão** mostra **Agente** só num host com o OpenCode ligado. Escolha **OpenCode**: a lista de
modelos vem do host (`opencode models`), **Esforço** escolhe o quanto o modelo trabalha, e os modos de
permissão são **Padrão** e **Planejar** (e **Ignorar permissões** quando o host permite). Não há
persona. Os modelos vêm agrupados por provedor. A página da sessão e a linha dela na lista de
sessões mostram um selo **OpenCode**. A linha do tempo diz quando o `AGENTS.md` do projeto foi com a
primeira mensagem, ou por que não foi.

## O que uma sessão do OpenCode pergunta

- Toda chamada de ferramenta pergunta antes, como uma sessão do Claude Code no modo Padrão. Ler,
  listar e buscar arquivos dentro da pasta da sessão é permitido sem perguntar, exceto arquivos de
  credenciais; um caminho que sai da pasta (inclusive por um link) pergunta.
- Nada é aprovado automaticamente, e o app nunca responde "sempre" ao OpenCode: cada resposta vale
  para um pedido.
- A ferramenta de perguntas do OpenCode e os subagentes dele ficam desligados.
- Uma mensagem que começa com `/` vai como texto comum, então os comandos do OpenCode (os dele e os
  de um projeto) não rodam.
- Se algo fora do Flightdeck mudar as regras ou o modo do OpenCode durante a sessão (a TUI do próprio
  OpenCode, um arquivo de config editado no meio), a sessão para com uma mensagem dizendo o que mudou.

## O que uma sessão do OpenCode ainda não tem

Isto fica com as sessões do Claude Code por enquanto: personas, times e mensagens entre sessões,
cards do quadro e variantes da arena, começar em segundo plano, bifurcar, "Abrir no terminal", o
resumo da sessão, as abas Mudanças, Tempo e Rastro (elas leem a transcrição do Claude Code), os
modos Aceitar edições e Automático, a aprovação automática, a página de Custos com orçamentos e
cota, importar as sessões antigas do OpenCode para o Histórico, e a tela de MCP. A linha do tempo
continua: os snapshots git são feitos a cada turno, então voltar arquivos funciona, e o modelo pode
ser trocado com a sessão em andamento, pela lista do OpenCode. A linha de resultado de cada turno ainda mostra o custo da sessão até ali, como o OpenCode
informa.

## Por que o opencode.json do projeto é ignorado

O `opencode.json` e a pasta `.opencode/` de um projeto podem liberar todas as ferramentas, carregar
plugins (código que roda quando o OpenCode sobe), iniciar servidores MCP e definir comandos. Por isso
o Flightdeck sobe o OpenCode com a config de projeto desligada e com dois agentes próprios
(`flightdeck` e `flightdeck-plan`), com os agentes embutidos do OpenCode desativados. O `AGENTS.md` do
projeto continua valendo: o Flightdeck o lê e o envia no começo de uma sessão nova, rotulado
"project instructions (AGENTS.md)", até 64 KB, sem seguir os `@` imports dele.

A sua config global do OpenCode (`~/.config/opencode`, ou `$XDG_CONFIG_HOME/opencode`) é mantida, então
seus provedores e seu modelo padrão continuam valendo, mas o daemon a examina antes de rodar o
OpenCode: um plugin (em `plugins` ou nas pastas `plugins/`, `plugin/`, `tool/` ou `tools/`), um
servidor MCP ativo, ou qualquer config de sistema ou gerenciada deixa o OpenCode indisponível naquele
host, com o achado nomeado. Antes de cada início e retomada, uma checagem prévia pergunta ao OpenCode
como ele resolveu a config para aquela pasta e recusa a sessão se algo passaria por cima das
perguntas do Flightdeck.

## Remover regras salvas

Responder "Always allow" na TUI do próprio OpenCode salva uma regra para o projeto daquela pasta, e
uma regra salva pula a pergunta. O Flightdeck então se recusa a abrir uma sessão do OpenCode ali, e a
mensagem lista as regras e os comandos que as removem. O Flightdeck nunca as remove sozinho. Naquela
pasta, no host:

```sh
opencode api GET /api/permission/saved --standalone              # lista as regras salvas
opencode api DELETE /api/permission/saved/<id> --standalone      # remove uma pelo id
```

## Conferir uma versão nova do OpenCode

`bun run smoke:opencode-real [--model <id>]` (num checkout do código, num host com o OpenCode
autenticado) roda o OpenCode de verdade contra um projeto hostil de rascunho: nenhum plugin, servidor
MCP ou comando `/` do projeto roda, o primeiro comando de shell pergunta, e uma regra salva faz a
checagem prévia recusar até ser removida. Ele apaga as sessões do OpenCode e as regras salvas que
criou. Rode depois de cada atualização do OpenCode; ele nunca faz parte dos testes nem da CI.
`bun run smoke:opencode` confere o mesmo caminho com um OpenCode falso.

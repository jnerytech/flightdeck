# Glossário

Um termo, um nome, nos dois idiomas. Os dicionários (`apps/desktop/src/i18n/pt-BR.ts` e `en.ts`)
seguem esta tabela, e o teste `textos` reprova texto visível fora deles.

| Português | English | Quando |
| --- | --- | --- |
| Aprovar | Approve | Pedido de permissão e gate de workflow: sempre o mesmo verbo |
| Negar | Deny | O oposto de Aprovar, também nos gates (o motivo só aparece depois) |
| Precisa de você | Needs you | O estado de uma sessão que espera uma resposta, a tela e o contador da barra lateral |
| sessão do terminal | terminal session | Uma sessão aberta fora do Flightdeck, no terminal, vista pelos hooks |
| sessão do Flightdeck | Flightdeck session | Uma sessão que o próprio app criou e controla |
| card | card | O item do board, com a sua worktree e as suas execuções |
| board | board | O quadro de cards de um projeto |
| workflow | workflow | Uma sequência de etapas (agente, check, gate) de um card |
| gate | gate | A etapa de um workflow que espera a aprovação de uma pessoa |
| host | host | A máquina onde roda o `flightdeckd` |
| daemon | daemon | O `flightdeckd`, o serviço de cada host |
| histórico | history | As conversas já gravadas pelo Claude Code, que o app só lê |
| cota | quota | O limite do plano, em janelas de 5 horas e de 7 dias |
| snippet | snippet | Um comando ou prompt salvo, com variáveis `{{nome}}`; global (do app), do host ou do projeto |
| persona | persona | Um papel de engenharia que o Claude assume numa sessão; do pacote, do host, do projeto ou global (do app) |
| pacote | pack | As personas que vêm prontas com o Flightdeck; editada, vira "Pacote, editada" |
| Aplicar persona | Apply persona | Manda o papel a uma sessão já aberta, como instrução da conversa; "Voltar ao normal" encerra |
| subagente persona | persona subagent | Uma persona oferecida ao Claude como agente `persona-<id>`, para ele delegar |
| destino SSH | SSH destination | Um servidor cadastrado em Conexões (host, porta, usuário, autenticação, etiquetas); a tela se chama Conexões / Connections |
| chave do servidor | server key | A chave que o servidor SSH mostra; o app guarda o fingerprint e bloqueia se ele mudar |
| cofre | vault | Onde ficam os segredos (chaves SSH, senhas, tokens, variáveis de ambiente), no cofre de credenciais do sistema |
| segredo | secret | Um item do cofre: o valor fica no cofre do sistema e o app só lista nome, tipo e etiquetas |
| frase-senha | passphrase | A frase que cifra o backup `.fdvault`; pelo menos 12 caracteres |
| turno | turn | One message of the user and the agent's whole answer to it; the timeline lists them |
| linha do tempo | timeline | The side panel of a session with its turns, what each changed in the files, and the rewind and fork actions |
| Voltar arquivos | Rewind files | Puts the repository's files back to how they were before a turn; files only, never external commands; it can be undone |
| Desfazer volta | Undo rewind | Brings the files back to how they were just before the last rewind |
| Bifurcar | Fork | A new conversation that starts from a turn of another; the original stays as it is |
| snapshot | snapshot | The git copy of the working tree taken at the start and end of a turn; it never touches the user's index or files |
| agente | agent | In "Agente de {project}", the project's configuration for Claude Code: MCP servers, CLAUDE.md, agents and skills |
| só leitura | read-only | What Flightdeck shows but never writes: the user's `~/.claude` and `~/.claude.json` |
| risco (baixo, médio, alto) | risk (low, medium, high) | O selo de um pedido de permissão; nunca `low`, `medium` e `high` na tela |
| segurar para aprovar | hold to approve | O Aprovar de um pedido de risco alto: o botão tem de ficar pressionado por 2 segundos |
| aprovado automaticamente | approved automatically | Um pedido aprovado por regra ou pela IA, sem a pessoa; a linha diz quem decidiu e o motivo |
| issue | issue | Um item do GitHub ou do Azure Boards listado no painel Issues do board; **Criar card** faz um card a partir dela |
| automação | automation | Um gatilho (horário, comentário no PR, checks do PR que falharam, issue com rótulo) que dispara uma ação; nasce desligada |
| arena | arena | O mesmo pedido de um card rodando em 2 a 4 variantes, para comparar e escolher |
| variante | variant | Uma das execuções de uma arena, com a própria worktree, branch, modelo e esforço |
| aba | tab | A screen open in the window, with its own back and forward history; it can be pinned and moved to the other area |
| área | area | One of the two halves of a split window, each with its own tab bar |
| Não lida | Unread | The badge of a session tab that answered while no tab showed it |
| terminal embutido | embedded terminal | A real shell on the host, opened by the daemon and shown in a tab, with no SSH |
| Desanexar | Detach | Closes the terminal's tab and leaves the process running on the host |
| Encerrar processo | End process | Closes the terminal's tab and ends the process |
| Claude aqui | Claude here | `flightdeckd claude` in a terminal tab, in a folder, a project or a card's worktree; the session is controllable from the app |
| ação | action | A command declared with places for vault secrets and parameters; Claude calls it by name and never receives the secret |
| confiada | trusted | An action whose declaration and executed files the user accepted; a change asks again |
| execuções | runs | The history of an action: who asked, exit code, duration and the masked output |
| regra de uso | usage rule | One rule of a secret: who, for what and when it may be used; the first that matches decides |
| teto | ceiling | What no rule may loosen: allow for run_with_secret, or allow for a prod secret without a window |
| janela | window | Days and hours, on this computer's clock, when a rule decides; outside it another decision holds |

## Estados de uma sessão

| Português | English |
| --- | --- |
| rodando | running |
| precisa de você | needs you |
| ociosa | idle |
| encerrada | ended |

## Modos de permissão

O valor técnico do modo nunca aparece na tela: só o nome e uma linha de explicação.

| Valor | Nome | Explicação |
| --- | --- | --- |
| `default` | Padrão / Default | pergunta antes de agir / asks before acting |
| `acceptEdits` | Aceitar edições / Accept edits | edita arquivos sem perguntar / edits files without asking |
| `plan` | Planejar / Plan | só lê e propõe um plano / only reads and proposes a plan |
| `auto` | Automático / Automatic | um classificador decide o que segue / a classifier decides what goes on |
| `dontAsk` | Só o permitido / Allowed only | nega o que as regras não liberam / denies what the rules do not allow |
| `bypassPermissions` | Sem perguntas / No questions | executa tudo, sem pedir aprovação (aviso em vermelho) / runs everything without asking (red warning) |

## Termos que não aparecem na tela

`bypassPermissions`, `acceptEdits`, `dontAsk`, `allowedRoots`, `subtype`, `claudeSessionId`,
`awaiting_permission`, `needs_you` e `pendingPermissions`. O teste `textos` varre as telas
principais atrás deles.

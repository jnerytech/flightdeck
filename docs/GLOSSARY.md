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

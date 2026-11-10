# Manual do Flightdeck

[English](en.md) | Português (Brasil) · [Voltar ao README](../../README.pt-BR.md)

Referência completa do Flightdeck, organizada por assunto, um arquivo por capítulo. O roadmap
está em [`docs/SPEC.md`](../SPEC.md), as divergências em relação às specs em
[`docs/decisions/`](../decisions/) (as mais antigas listadas em [`docs/DECISIONS.md`](../DECISIONS.md)) e o vocabulário da interface em
[`docs/GLOSSARY.md`](../GLOSSARY.md). O manual supõe `flightdeckd` no `PATH`; o binário instalado
fica em `~/.flightdeck/bin`, que o `update` não acrescenta ao `PATH`.

## Visão geral

[Ler o capítulo.](pt-BR/overview.md)

## Instalação

[Ler o capítulo.](pt-BR/installation.md) Suas seções:

- [Pelos binários da release](pt-BR/installation.md#pelos-binários-da-release)
- [A partir do código-fonte](pt-BR/installation.md#a-partir-do-código-fonte)

## Hosts e configuração do daemon

[Ler o capítulo.](pt-BR/hosts-and-daemon-configuration.md) Suas seções:

- [O arquivo de configuração](pt-BR/hosts-and-daemon-configuration.md#o-arquivo-de-configuração)
- [Subir o daemon](pt-BR/hosts-and-daemon-configuration.md#subir-o-daemon)
- [Conectar o app desktop](pt-BR/hosts-and-daemon-configuration.md#conectar-o-app-desktop)
- [Confiar em um projeto](pt-BR/hosts-and-daemon-configuration.md#confiar-em-um-projeto)
- [Manter o computador acordado](pt-BR/hosts-and-daemon-configuration.md#manter-o-computador-acordado)
- [Sessões sem pedidos de permissão](pt-BR/hosts-and-daemon-configuration.md#sessões-sem-pedidos-de-permissão)

## Serviço

[Ler o capítulo.](pt-BR/service.md) Suas seções:

- [Primeira execução: flightdeckd setup](pt-BR/service.md#primeira-execução-flightdeckd-setup)
- [Instalar como serviço](pt-BR/service.md#instalar-como-serviço)
- [WSL a partir do Windows](pt-BR/service.md#wsl-a-partir-do-windows)

## Acesso remoto pela Tailscale

[Ler o capítulo.](pt-BR/remote-access-over-tailscale.md)

## Pareamento

[Ler o capítulo.](pt-BR/pairing.md)

## Central de sessões e hooks do Claude Code

[Ler o capítulo.](pt-BR/session-hub-and-claude-code-hooks.md) Suas seções:

- [O que aparece na lista](pt-BR/session-hub-and-claude-code-hooks.md#o-que-aparece-na-lista)
- [A caixa de mensagem](pt-BR/session-hub-and-claude-code-hooks.md#a-caixa-de-mensagem)
- [Hooks do Claude Code](pt-BR/session-hub-and-claude-code-hooks.md#hooks-do-claude-code)
- [Aprovar sessões do terminal pelo app](pt-BR/session-hub-and-claude-code-hooks.md#aprovar-sessões-do-terminal-pelo-app)

## flightdeckd claude e o canal

[Ler o capítulo.](pt-BR/flightdeckd-claude-and-the-channel.md) Suas seções:

- [Como funciona](pt-BR/flightdeckd-claude-and-the-channel.md#como-funciona)
- [Por que a extensão do VS Code fica de fora](pt-BR/flightdeckd-claude-and-the-channel.md#por-que-a-extensão-do-vs-code-fica-de-fora)

## Aprovações e permitir sempre

[Ler o capítulo.](pt-BR/approvals-and-always-allow.md)

## Sessões do OpenCode

[Ler o capítulo.](pt-BR/opencode-sessions.md) Suas seções:

- [Ligar](pt-BR/opencode-sessions.md#ligar)
- [Abrir uma sessão](pt-BR/opencode-sessions.md#abrir-uma-sessão)
- [O que uma sessão do OpenCode pergunta](pt-BR/opencode-sessions.md#o-que-uma-sessão-do-opencode-pergunta)
- [O que uma sessão do OpenCode ainda não tem](pt-BR/opencode-sessions.md#o-que-uma-sessão-do-opencode-ainda-não-tem)
- [Por que o opencode.json do projeto é ignorado](pt-BR/opencode-sessions.md#por-que-o-opencodejson-do-projeto-é-ignorado)
- [Remover regras salvas](pt-BR/opencode-sessions.md#remover-regras-salvas)
- [Conferir uma versão nova do OpenCode](pt-BR/opencode-sessions.md#conferir-uma-versão-nova-do-opencode)

## Projetos

[Ler o capítulo.](pt-BR/projects.md) Suas seções:

- [Mover uma sessão para outro host (prévia)](pt-BR/projects.md#mover-uma-sessão-para-outro-host-prévia)
- [Dormir sessões ociosas](pt-BR/projects.md#dormir-sessões-ociosas)
- [Sessões lado a lado](pt-BR/projects.md#sessões-lado-a-lado)
- [A barra lateral, a barra de abas e as Configurações](pt-BR/projects.md#a-barra-lateral-a-barra-de-abas-e-as-configurações)

## Board

[Ler o capítulo.](pt-BR/board.md) Suas seções:

- [Trabalhar com vários cards](pt-BR/board.md#trabalhar-com-vários-cards)
- [Iniciar uma sessão pela tarefa](pt-BR/board.md#iniciar-uma-sessão-pela-tarefa)
- [Escolher uma pasta](pt-BR/board.md#escolher-uma-pasta)
- [Cadastrar um projeto](pt-BR/board.md#cadastrar-um-projeto)
- [Achar projetos](pt-BR/board.md#achar-projetos)
- [Começar pelo GitHub](pt-BR/board.md#começar-pelo-github)
- [Sincronização do quadro com o GitHub Projects](pt-BR/board.md#sincronização-do-quadro-com-o-github-projects)
- [Ciclo do card](pt-BR/board.md#ciclo-do-card)
- [Provedores de PR](pt-BR/board.md#provedores-de-pr)
- [Limite de execuções paralelas](pt-BR/board.md#limite-de-execuções-paralelas)
- [Dependências entre cards](pt-BR/board.md#dependências-entre-cards)

## Revisão de mudanças

[Ler o capítulo.](pt-BR/reviewing-changes.md) Suas seções:

- [As visões da página de uma sessão](pt-BR/reviewing-changes.md#as-visões-da-página-de-uma-sessão)
- [`.worktreeinclude`](pt-BR/reviewing-changes.md#worktreeinclude)
- [Statusline do Claude Code](pt-BR/reviewing-changes.md#statusline-do-claude-code)

## Ambiente de execução

[Ler o capítulo.](pt-BR/run-environment.md) Suas seções:

- [O run.yaml](pt-BR/run-environment.md#o-runyaml)
- [Confiança](pt-BR/run-environment.md#confiança)
- [Portas](pt-BR/run-environment.md#portas)
- [Run e Stop](pt-BR/run-environment.md#run-e-stop)
- [Preview](pt-BR/run-environment.md#preview)

## Workflows

[Ler o capítulo.](pt-BR/workflows.md) Suas seções:

- [Declarar](pt-BR/workflows.md#declarar)
- [Confiar](pt-BR/workflows.md#confiar)
- [Criar cards com os achados de um agente](pt-BR/workflows.md#criar-cards-com-os-achados-de-um-agente)
- [Executar de novo uma execução que falhou](pt-BR/workflows.md#executar-de-novo-uma-execução-que-falhou)
- [Modelos](pt-BR/workflows.md#modelos)
- [Rodar e acompanhar](pt-BR/workflows.md#rodar-e-acompanhar)
- [Orçamento de uma execução](pt-BR/workflows.md#orçamento-de-uma-execução)
- [O servidor MCP flightdeckd mcp](pt-BR/workflows.md#o-servidor-mcp-flightdeckd-mcp)
- [O comando flightdeckd card](pt-BR/workflows.md#o-comando-flightdeckd-card)

## Histórico

[Ler o capítulo.](pt-BR/history.md) Suas seções:

- [O que é indexado](pt-BR/history.md#o-que-é-indexado)
- [Excluir pastas](pt-BR/history.md#excluir-pastas)
- [Reconstruir o índice](pt-BR/history.md#reconstruir-o-índice)
- [No app](pt-BR/history.md#no-app)

## Checkpoints e configuração do agente

[Ler o capítulo.](pt-BR/checkpoints-and-agent-configuration.md) Suas seções:

- [Snapshots](pt-BR/checkpoints-and-agent-configuration.md#snapshots)
- [A linha do tempo](pt-BR/checkpoints-and-agent-configuration.md#a-linha-do-tempo)
- [Voltar arquivos](pt-BR/checkpoints-and-agent-configuration.md#voltar-arquivos)
- [Bifurcar](pt-BR/checkpoints-and-agent-configuration.md#bifurcar)
- [A tela Agente](pt-BR/checkpoints-and-agent-configuration.md#a-tela-agente)

## Issues, automações e arena

[Ler o capítulo.](pt-BR/issues-automations-and-arena.md) Suas seções:

- [Issues](pt-BR/issues-automations-and-arena.md#issues)
- [Automações](pt-BR/issues-automations-and-arena.md#automações)
- [Arena](pt-BR/issues-automations-and-arena.md#arena)

## Aprovação graduada por risco

[Ler o capítulo.](pt-BR/risk-graded-approval.md)

## Sessões em segundo plano

[Ler o capítulo.](pt-BR/background-sessions.md)

## Rastro e replay da sessão

[Ler o capítulo.](pt-BR/session-trace-and-replay.md)

## Tempo das sessões (telemetria)

[Ler o capítulo.](pt-BR/session-timing-telemetry.md)

## Conexões

[Ler o capítulo.](pt-BR/connections.md)

## Cofre

[Ler o capítulo.](pt-BR/vault.md) Suas seções:

- [Backup de tudo](pt-BR/vault.md#backup-de-tudo)

## Ações: o Claude usa um segredo sem vê-lo

[Ler o capítulo.](pt-BR/actions-claude-uses-a-secret-without-seeing-it.md) Suas seções:

- [A tela Ações](pt-BR/actions-claude-uses-a-secret-without-seeing-it.md#a-tela-ações)
- [Aprovar um pedido](pt-BR/actions-claude-uses-a-secret-without-seeing-it.md#aprovar-um-pedido)
- [Regras de uso por segredo](pt-BR/actions-claude-uses-a-secret-without-seeing-it.md#regras-de-uso-por-segredo)
- [Como o Claude chama uma ação](pt-BR/actions-claude-uses-a-secret-without-seeing-it.md#como-o-claude-chama-uma-ação)
- [O limite: o mesmo usuário do sistema](pt-BR/actions-claude-uses-a-secret-without-seeing-it.md#o-limite-o-mesmo-usuário-do-sistema)

## Central de notificações

[Ler o capítulo.](pt-BR/notification-center.md) Suas seções:

- [Ajustar as notificações](pt-BR/notification-center.md#ajustar-as-notificações)

## Lista de configuração inicial

[Ler o capítulo.](pt-BR/setup-checklist.md)

## Snippets

[Ler o capítulo.](pt-BR/snippets.md)

## Personas

[Ler o capítulo.](pt-BR/personas.md)

## Memória, contexto e plugins

[Ler o capítulo.](pt-BR/memory-context-and-plugins.md) Suas seções:

- [Memória e contexto](pt-BR/memory-context-and-plugins.md#memória-e-contexto)
- [Plugins](pt-BR/memory-context-and-plugins.md#plugins)

## Vigiar e consertar um PR

[Ler o capítulo.](pt-BR/watching-and-fixing-a-pr.md)

## Times e mensagens entre sessões

[Ler o capítulo.](pt-BR/teams-and-messages-between-sessions.md) Suas seções:

- [Nomes padronizados de sessão](pt-BR/teams-and-messages-between-sessions.md#nomes-padronizados-de-sessão)
- [Quem pode falar com quem](pt-BR/teams-and-messages-between-sessions.md#quem-pode-falar-com-quem)
- [Times](pt-BR/teams-and-messages-between-sessions.md#times)

## Custos, orçamentos e cota

[Ler o capítulo.](pt-BR/costs-budgets-and-quota.md) Suas seções:

- [A conta do Claude de um host](pt-BR/costs-budgets-and-quota.md#a-conta-do-claude-de-um-host)
- [Cota do plano](pt-BR/costs-budgets-and-quota.md#cota-do-plano)
- [A barra de status](pt-BR/costs-budgets-and-quota.md#a-barra-de-status)
- [Fila por cota](pt-BR/costs-budgets-and-quota.md#fila-por-cota)
- [Uso](pt-BR/costs-budgets-and-quota.md#uso)
- [Custos](pt-BR/costs-budgets-and-quota.md#custos)
- [Preços](pt-BR/costs-budgets-and-quota.md#preços)
- [Orçamentos](pt-BR/costs-budgets-and-quota.md#orçamentos)
- [Histórico da cota](pt-BR/costs-budgets-and-quota.md#histórico-da-cota)
- [Retorno sobre o custo](pt-BR/costs-budgets-and-quota.md#retorno-sobre-o-custo)

## Clientes: agrupar o trabalho entre hosts e projetos

[Ler o capítulo.](pt-BR/clients-grouping-work-across-hosts-and-projects.md)

## Resumo da sessão e webhooks

[Ler o capítulo.](pt-BR/session-summary-and-webhooks.md) Suas seções:

- [O resumo](pt-BR/session-summary-and-webhooks.md#o-resumo)
- [Webhooks](pt-BR/session-summary-and-webhooks.md#webhooks)

## Abas e terminal embutido

[Ler o capítulo.](pt-BR/tabs-and-embedded-terminal.md) Suas seções:

- [Abas](pt-BR/tabs-and-embedded-terminal.md#abas)
- [Tela dividida](pt-BR/tabs-and-embedded-terminal.md#tela-dividida)
- [Terminal embutido](pt-BR/tabs-and-embedded-terminal.md#terminal-embutido)
- [Claude aqui](pt-BR/tabs-and-embedded-terminal.md#claude-aqui)

## Uso diário

[Ler o capítulo.](pt-BR/daily-use.md) Suas seções:

- [Precisa de você, página do host e notificações](pt-BR/daily-use.md#precisa-de-você-página-do-host-e-notificações)
- [Bandeja](pt-BR/daily-use.md#bandeja)
- [Abrir no terminal](pt-BR/daily-use.md#abrir-no-terminal)
- [Paleta Ctrl+K](pt-BR/daily-use.md#paleta-ctrlk)
- [Atalhos de teclado](pt-BR/daily-use.md#atalhos-de-teclado)
- [Atalho global](pt-BR/daily-use.md#atalho-global)

## Interface

[Ler o capítulo.](pt-BR/interface.md) Suas seções:

- [Desenho e navegação](pt-BR/interface.md#desenho-e-navegação)
- [Modo demonstração, prints e testes de ponta a ponta](pt-BR/interface.md#modo-demonstração-prints-e-testes-de-ponta-a-ponta)
- [Logs e diagnóstico](pt-BR/interface.md#logs-e-diagnóstico)
- [Desempenho](pt-BR/interface.md#desempenho)

## Operação do host

[Ler o capítulo.](pt-BR/host-operations.md) Suas seções:

- [Versões e compatibilidade](pt-BR/host-operations.md#versões-e-compatibilidade)
- [Atualizar com flightdeckd update](pt-BR/host-operations.md#atualizar-com-flightdeckd-update)
- [Sessões que um reinício interrompeu](pt-BR/host-operations.md#sessões-que-um-reinício-interrompeu)
- [Atualização automática assinada](pt-BR/host-operations.md#atualização-automática-assinada)
- [Retenção](pt-BR/host-operations.md#retenção)
- [Backup e restauração](pt-BR/host-operations.md#backup-e-restauração)

## Deploy

[Ler o capítulo.](pt-BR/deploy.md)

## Releases

[Ler o capítulo.](pt-BR/releases.md)

## Desenvolvimento

[Ler o capítulo.](pt-BR/development.md)

## Modo simples

[Ler o capítulo.](pt-BR/simple-mode.md)

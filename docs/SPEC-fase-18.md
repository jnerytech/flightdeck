# Flightdeck — Spec da Fase 18 (Snippets)

## Objetivo e escopo

**Snippets** são comandos e prompts salvos, por projeto, por host ou globais. Você os dispara pela paleta, numa aba de terminal ou numa sessão, e o Claude também pode chamá-los pelo nome.

Pré-requisitos:
- Fase 14, para colar e rodar no terminal embutido;
- Fase 8, a paleta;
- Fase 17, para um snippet de comando que usa segredo virar uma ação.

**Fora da Fase 18**

- Uma biblioteca pública de snippets compartilhada entre pessoas.
- Macros de várias etapas. Para isso existem os workflows da Fase 6.

## Tipos

| Tipo | O que é | Onde roda |
| --- | --- | --- |
| `command` | um comando de terminal, com variáveis `{{nome}}` | colado na aba de terminal ativa (com Enter ou sem), ou rodado numa aba nova no cwd escolhido |
| `prompt` | um texto para o Claude, com variáveis | enviado à sessão ativa (gerenciada, de card ou do terminal controlável), ou como prompt de uma sessão nova |

- **Variáveis:** `{{nome}}` vira um campo na hora de usar, com valor padrão e lista de opções opcional. Variáveis especiais:
  - `{{cwd}}`;
  - `{{branch}}`, a branch atual do cwd;
  - `{{file}}`, um arquivo escolhido;
  - `{{selection}}`, o texto selecionado no terminal ou no diff.
- **Segredos:** um snippet de comando **não leva segredo**. Quem precisa de segredo vira uma ação da Fase 17, e o app oferece "Transformar em ação".

## Onde ficam

- **Globais:** no armazenamento do app.
- **Do host:** no daemon do host.
- **Do projeto:** em `.flightdeck/snippets.yaml`, versionado e compartilhável pelo repositório, ou no daemon, se for só seu:
  ```yaml
  - name: testes-rapidos
    type: command
    run: "bun test {{arquivo}}"
    vars: { arquivo: { default: "" } }
  - name: revisar-seguranca
    type: prompt
    text: "Revise {{file}} procurando injeção, segredos expostos e validação faltando. Responda em tópicos."
  ```
- **Snippets versionados de comando:** só aparecem para colar. Rodar direto exige confiar no arquivo pelo hash, como os workflows. Os de prompt não precisam disso.
- **Importar:** de um arquivo YAML ou JSON. "Importar do histórico do shell" oferece os comandos mais usados do `~/.bash_history`, do histórico do PSReadLine no Windows e do `~/.zsh_history`, **só para leitura e com escolha linha a linha**.
  - **Varredura de segredos:** históricos costumam ter tokens digitados na linha. Cada linha candidata é conferida contra padrões de segredo (tokens `ghp_`, `sk-`, `AKIA`, chaves privadas, `password=`, `token=`, Bearer) e contra os valores do próprio cofre.
  - Linha marcada fica **oculta e não selecionável**, a menos que você a revele.
  - O que vem do histórico vai por padrão para o escopo global ou do host, **nunca para o `.flightdeck/snippets.yaml`**.
  - Salvar no arquivo versionado roda a mesma varredura em todo o conteúdo e recusa ao achar algo, porque o repositório pode ser público.

## Usar

- **Paleta (Ctrl+K):** "Snippet: <nome>" filtra por nome, tag e conteúdo, preenche as variáveis e executa.
- **Aba de terminal:** um atalho próprio (Ctrl+Shift+Espaço) abre a lista dos snippets de comando do projeto e do host daquele terminal.
- **Sessão:** no campo de mensagem, `/` lista os snippets de prompt.
- **O Claude:** as ferramentas `list_snippets` e `get_snippet` do MCP do Flightdeck e do mod da Fase 17 devolvem o texto.
  - O Claude pode **ler** o snippet e usá-lo como referência.
  - Rodar um snippet de comando pelo Claude passa pelas regras normais de permissão do Claude Code. Nada é executado pelo Flightdeck em nome do Claude.
- **Recentes e favoritos:** no topo da lista, por projeto.

## Protocolo (só adições)

| Item | Tipo | Conteúdo |
| --- | --- | --- |
| `snippets.list` / `snippets.save` / `snippets.remove` | comando | escopo (`host` ou `project`) e filtros |
| `snippets.trust` | comando | o hash do `snippets.yaml` versionado |
| `snippets.importHistory` | comando | prévia dos comandos mais usados do histórico do shell do host, só leitura |

## Testes e critérios

| Área | O que precisa passar |
| --- | --- |
| `snippets-modelo` | os dois tipos; variáveis com padrão e opções; especiais (`cwd`, `branch`, `file`, `selection`); snippet com segredo recusado, com a oferta de virar ação |
| `snippets-escopos` | global, host e projeto; o versionado carrega e precisa de confiança para rodar; colar sem confiança é permitido |
| `snippets-historico` | lê históricos de bash, zsh e PSReadLine de fixtures, só para leitura; ordena por frequência; escolha linha a linha; linhas com padrão de segredo ou valor do cofre ocultas e não selecionáveis; importação vai para global ou host; salvar no `snippets.yaml` com segredo é recusado |
| `snippets-uso` | paleta com variáveis; colar ou rodar no terminal (PTY falso); enviar à sessão ativa; `/` na caixa de mensagem |
| `snippets-mcp` | `list_snippets` e `get_snippet` pelo MCP e pelo mod; o Flightdeck não executa nada pelo Claude |
| `snippets-ui` | tela de snippets por escopo; editor com prévia das variáveis; favoritos e recentes |

**Critérios de aceite:**
- [ ] Os de sempre: TDD por área, auditoria, cobertura de 100%, todos os smokes, builds, CI verde, prints, versões em `0.18.0`, README e DECISIONS.
- [ ] Conferência com o usuário: importar snippets do histórico dele e usar um pela paleta numa aba de terminal.

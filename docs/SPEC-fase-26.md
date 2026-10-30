# Flightdeck — Spec da Fase 26 (Memória, contexto e plugins do Claude Code)

## Objetivo

Duas extensões naturais do editor de configuração do agente (Fase 12):

1. **Memória e contexto:**
   - ver e editar a memória automática do Claude Code (o `MEMORY.md` e os arquivos por tópico) por projeto;
   - saber **o que entra no contexto**: quais CLAUDE.md e regras são carregados, e quanto da memória cabe na partida, já que só o começo do `MEMORY.md` entra.

   Memória que cresce sem ninguém olhar vira ruído e custo em toda sessão.
2. **Plugins:** listar, instalar, atualizar, fixar versão e remover plugins e marketplaces do Claude Code, mostrando **o que cada um instala**: hooks, monitores, skills, agentes, comandos e MCP. Plugin executa código na máquina, então ver é segurança.

Origem: pesquisa de 30/10/2026. O `/memory` e o `/plugin` do CLI não têm interface. Pré-requisitos: Fase 12.

## Desenho

- **Memória:**
  - **Leitura:** a pasta de memória do projeto, no caminho que o Claude Code usa, confirmado por prova de conceito na versão instalada.
  - **Edição:** as escritas seguem a regra da Fase 12, com confirmação e conflito por hash. A memória é do usuário e do projeto. O Flightdeck só mexe nela por ação explícita na tela, e registra a decisão.
  - **"Orçamento de contexto":** uma estimativa de tokens por fonte (CLAUDE.md em cada nível, regras, memória e skills), com o limite de linhas e bytes da memória na partida destacado. Mostra o que fica de fora.
  - **Limpeza sugerida:** entradas duplicadas, antigas ou contraditórias, apontadas sem edição automática.
- **Plugins:**
  - pela CLI (`claude plugin list | install | update | uninstall | validate`, `claude plugin marketplace …`), em processo filho;
  - cada plugin mostra o manifesto, os hooks com os eventos que escuta, os monitores, as skills, os agentes, os comandos e os servidores MCP;
  - antes de instalar ou atualizar, um resumo do que muda, com o hash do conteúdo, e a confirmação;
  - há a opção de fixar a versão;
  - plugins com hooks em eventos sensíveis (PreToolUse e PermissionRequest) ganham um selo de atenção.
- **Segurança:** nada é instalado sem confirmação. O validate roda antes de instalar plugin local.

## Testes e critérios

| Área | O que precisa passar |
| --- | --- |
| `memoria` | ler e editar com hash e confirmação; orçamento de contexto por fonte; o que fica de fora; sugestões sem edição automática |
| `plugins` | listar e detalhar pela CLI falsa; instalar e atualizar com resumo, hash e confirmação; fixar versão; selo em hooks sensíveis |
| `memoria-plugins-ui` | as telas e os avisos |

**Critérios de aceite:** os de sempre, a versão `0.26.0` e a prova de conceito dos caminhos e comandos na versão instalada.

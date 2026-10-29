# Flightdeck — Spec da Fase 20 (Personas de engenharia)

## Objetivo e escopo

Uma **persona** é um papel de engenharia que o Claude assume numa sessão: arquiteto, revisor de segurança, QA, SRE e outros. Ela tem instruções, modelo e esforço sugeridos e ferramentas permitidas.

A Fase 20 deixa:
- **escolher a persona ao abrir uma sessão**;
- **aplicá-la a uma sessão aberta**;
- **chamá-la como subagente**;
- **usá-la em workflows, na arena e no board**.

Pré-requisitos:
- Fase 10 (Interface);
- Fase 12, onde está o editor de agentes do projeto, que esta fase reaproveita;
- Fase 13, para a arena;
- Fase 14, para o "Claude aqui".

**Fora da Fase 20**

- Personas que mudam permissões além das regras do Claude Code. Uma persona só restringe ferramentas, nunca amplia.
- Marketplace público de personas.

## Fatos (Agent SDK 0.3.312 e claude 2.1.312)

- **SDK:**
  - `systemPrompt: { type: 'preset', preset: 'claude_code', append }` acrescenta instruções ao prompt padrão do Claude Code;
  - `agents: Record<string, AgentDefinition>` declara subagentes pelo código.
- **CLI:**
  - `--append-system-prompt <texto>` e `--append-system-prompt-file <arquivo>`;
  - `--agents <json-ou-arquivo>`.

## Modelo

```yaml
# Global (app), do host (daemon) ou do projeto em .flightdeck/personas/<id>.md (versionado)
---
id: seguranca
name: Revisor de segurança
description: Revisa mudanças procurando falhas de segurança e explica o risco de cada uma
icon: shield
model: claude-opus-5-5        # sugerido; a sessão pode trocar
effort: high
tools: [Read, Grep, Glob, Bash]   # opcional: restringe; ausente = as da sessão
permissionMode: plan          # opcional: sugere; nunca acima do da sessão
---
Você atua como revisor de segurança sênior...
- Procure injeção (SQL, comando, caminho), segredos expostos, validação faltando, permissões amplas.
- Classifique cada achado por gravidade e mostre a linha.
- Não altere código: proponha a correção.
```

- **Corpo:** é o texto acrescentado ao system prompt. Ele tem limite de 8 KB e não pode conter segredos: o salvar roda a varredura da Fase 18 e recusa se achar algum.
- **`tools`:** só restringe. A persona nunca libera uma ferramenta que a sessão não teria.
- **`permissionMode`:** é só uma sugestão. Se ele for mais permissivo que o da sessão, prevalece o da sessão.
- **Personas versionadas:** as de um `.flightdeck/personas` versionado precisam de confiança pelo hash, como os workflows (Fase 6), antes do primeiro uso, porque mudam o comportamento do agente.

## Pacote inicial

Nove personas vêm prontas, em pt-BR e en, editáveis, e cada uma pode ser restaurada ao original:

| id | Nome | Foco |
| --- | --- | --- |
| `arquiteto` | Arquiteto | desenho, trade-offs e ADRs; propõe antes de codar |
| `seguranca` | Revisor de segurança | OWASP, segredos, injeção, permissões; gravidade por achado |
| `qa` | QA / testes | TDD, casos de borda, cobertura, testes instáveis |
| `sre` | SRE / DevOps | CI, deploy, observabilidade, rollback e runbooks |
| `performance` | Performance | medir antes, profiling, complexidade, regressões |
| `revisor` | Revisor de código | legibilidade, padrões do repositório, diffs pequenos |
| `docs` | Tech writer | README, guias, changelog, exemplos que funcionam |
| `frontend` | Frontend / UX | acessibilidade, estados de tela, consistência visual |
| `dba` | DBA | migrações seguras, índices, consultas e planos |

## Usar

- **Sessão nova:** o seletor "Persona" aparece no "+ nova sessão", no "Claude aqui" (Fase 14), no iniciar card e na paleta ("Nova sessão como <persona>").
  - **Sessão gerenciada:** `systemPrompt.append` com o corpo, mais `model`, `effort` e `allowedTools`, ou o `canUseTool`, conforme o que a persona trouxer.
  - **Terminal (`flightdeckd claude --persona <id>`):** o wrapper grava o corpo num arquivo temporário e passa `--append-system-prompt-file`, mais `--model`. O arquivo é apagado quando o claude termina.
- **Sessão aberta:** "Aplicar persona" manda uma mensagem de troca de papel com o corpo da persona.
  - Vale para a sessão gerenciada e para a do terminal controlável (Fase 5).
  - A troca fica registrada na linha do tempo, e "Voltar ao normal" manda a mensagem de saída do papel.
  - O app diz claramente que, numa sessão aberta, a persona vale como instrução da conversa, e não do sistema.
- **Como subagente:**
  - as personas do projeto viram agentes para o Claude chamar, com o nome `persona-<id>`;
  - na sessão gerenciada, vão pela opção `agents` do SDK;
  - no terminal, pelo `--agents <json>` do wrapper;
  - o Claude pode delegar, por exemplo "use o persona-seguranca para revisar este diff".
- **Publicar como agente do projeto:** "Publicar como agente do projeto" grava a persona em `.claude/agents/persona-<id>.md` pelo editor da Fase 12, com confirmação. Assim, ela vale também para quem usa o `claude` puro.

## Com o que já existe

- **Workflows (Fase 6):** a etapa `agent` ganha `persona: <id>`. O exemplo de revisão em paralelo passa a ser `- agent: { persona: seguranca, prompt: … }` e `- agent: { persona: revisor, prompt: … }`.
- **Arena (Fase 13):** cada variante pode ter uma persona, e a comparação mostra qual persona produziu cada resultado.
- **Board:** cada coluna ou tipo de card pode ter uma persona padrão, configurada no projeto. Um card em "Em revisão" que reabre uma sessão, por exemplo, usa o `revisor`.
- **Central (Fase 5):** a sessão mostra o selo da persona, com o ícone e o nome, e dá para filtrar a lista por persona.
- **Custos (Fase 8):** o uso pode ser quebrado por persona.

## Protocolo (só adições)

| Item | Tipo | Conteúdo |
| --- | --- | --- |
| `personas.list` / `personas.save` / `personas.remove` / `personas.reset` / `personas.trust` | comando | por escopo (`app`, `host` ou `project`); `reset` volta ao original do pacote; `trust` pelo hash das versionadas |
| `session.create` / `card.start` | comando | ganham `persona?` |
| `session.applyPersona` / `session.clearPersona` | comando | sessão gerenciada ou do terminal controlável |
| `personas.publishAgent` | comando | grava em `.claude/agents` pelo editor da Fase 12, com `confirm` |
| `SessionSummary` e `ExternalSession` | dado | ganham `persona?` |

## Testes e critérios

| Área | O que precisa passar |
| --- | --- |
| `personas-modelo` | frontmatter validado; corpo com limite de 8 KB e varredura de segredos; `tools` só restringe; `permissionMode` nunca acima do da sessão; versionadas pedem confiança pelo hash |
| `personas-pacote` | as 9 do pacote nos dois idiomas; editar e restaurar ao original |
| `personas-sessao-nova` | gerenciada com `systemPrompt.append`, `model` e `effort` pelo runtime falso; terminal com `--append-system-prompt-file` e `--model` pelo claude falso, e arquivo apagado no fim |
| `personas-sessao-aberta` | aplicar e voltar ao normal por mensagem, na gerenciada e na do terminal controlável; registro na linha do tempo |
| `personas-subagente` | `agents` do SDK e `--agents` do wrapper com `persona-<id>`; publicar como agente do projeto grava em `.claude/agents` com confirmação |
| `personas-integracoes` | `persona` na etapa de workflow; persona por variante na arena; persona padrão por coluna; selo e filtro na central; custo por persona |
| `personas-ui` | biblioteca com escopos; editor com prévia; seletor no "+", no "Claude aqui", no card e na paleta; "Aplicar persona" e "Voltar ao normal" |

**Critérios de aceite**
- [ ] Os de sempre: TDD por área, auditoria, cobertura de 100%, todos os smokes, builds, CI verde, prints, versões em `0.20.0`, README e DECISIONS.
- [ ] Conferência com o claude real:
  - uma sessão nova com a persona `seguranca` responde no papel, conferido no transcript;
  - um `flightdeckd claude --persona qa` mostra a persona aplicada;
  - numa sessão, o Claude delega ao `persona-revisor` como subagente.

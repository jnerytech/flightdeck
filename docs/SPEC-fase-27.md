# Flightdeck — Spec da Fase 27 (Sessões em segundo plano do Claude Code)

## Objetivo

O Claude Code 2.1.312 tem **sessões em segundo plano**:
- `claude --bg` inicia uma sessão sem terminal;
- `claude agents` lista e gerencia essas sessões;
- `claude daemon run|status` é o supervisor por usuário.

Isso foi conferido no `--help` do CLI instalado em 30/10/2026. Se o usuário passar a usar isso, a central de sessões precisa **enxergar, abrir e controlar** essas sessões como faz com as do terminal.

Pré-requisitos: Fase 5 (central, hooks, canal) e Fase 14 (terminal).

## Prova de conceito primeiro

Antes de qualquer área, uma prova com o claude real (orquestrador ou sessão, com prompt curto e no Sonnet) responde:
1. Os hooks (SessionStart, PermissionRequest, Stop) disparam nas sessões em segundo plano? O receptor da Fase 5 as recebe?
2. O `claude agents` tem saída em JSON, ou algum outro jeito estável de listar, com id, cwd, estado e custo?
3. Dá para mandar mensagem a uma sessão em segundo plano: pelo canal da Fase 5 (`--dangerously-load-development-channels` funciona com `--bg`?) ou por um comando do `claude agents`?
4. Como uma permissão é pedida e respondida numa sessão sem terminal?
5. O que acontece quando o PC dorme ou reinicia (`claude respawn`)?

O resultado vai para o DECISIONS e define o tamanho da fase.

## Desenho (a confirmar pela prova)

- **Na central:** a origem "segundo plano", com selo próprio. O estado vem dos hooks e da listagem do `claude agents`.
- **Ações:**
  - abrir o transcript ao vivo;
  - aprovar e negar, pelo hook PermissionRequest, como no terminal;
  - mandar mensagem, se a prova mostrar um caminho;
  - "Trazer para o terminal", que abre uma aba da Fase 14 com o comando de retomar;
  - parar e reiniciar, pelos comandos do `claude agents`.
- **"Iniciar em segundo plano"** no "+ nova sessão" e no card, com `flightdeckd claude --bg`, para a sessão nascer controlável e com a persona.

## Testes e critérios

| Área | O que precisa passar |
| --- | --- |
| `bg-listar` | as sessões em segundo plano aparecem na central, com estado (CLI falsa e hooks falsos, no formato confirmado pela prova) |
| `bg-controlar` | aprovar e negar, mensagem (se houver caminho), trazer ao terminal, parar e reiniciar |
| `bg-iniciar` | iniciar em segundo plano pelo app, controlável e com persona |
| `bg-ui` | selo, filtro e ações |

**Critérios de aceite:** os de sempre, a versão `0.27.0` e a prova de conceito registrada.

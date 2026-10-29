# Flightdeck — Spec da Fase 10 (Revisão de mudanças)

## Objetivo e escopo

Todo card, e quase toda sessão, termina num diff que você precisa conferir. A Fase 10 faz do Flightdeck o lugar onde se revisa:

- comentar linhas do diff e mandar a revisão para o agente;
- reverter ou editar arquivos antes do commit;
- trazer os comentários do PR para o agente;
- fechar o card com merge local;
- carregar a worktree com os arquivos ignorados que fazem falta;
- saber que sessão mexeu em qual arquivo.

Inclui também um comando de statusline para o terminal.

Pré-requisito: Fase 8 fechada (tag `fase-8`). A fase pode ser desenvolvida em paralelo às Fases 9 e 11, num worktree próprio, e é rebaseada sobre a fase anterior integrada antes de fechar.

As ideias vêm de apps do mesmo espaço (vibe-kanban, parallel-code, Paradev, Agent Console, Crystal, ccmanager, Nimbalyst e ccusage), levantados pelo orquestrador em 29/10/2026.

**Fora da Fase 10**

- Postar comentários ou respostas no GitHub ou no Azure DevOps: o Flightdeck só lê os comentários do PR.
- Editor de código completo, como uma IDE. A edição desta fase é pontual, arquivo a arquivo.
- Revert por trecho (hunk). O revert é por arquivo.

## Design

### Aba Mudanças (qualquer sessão)

- **Onde aparece:** em toda sessão cujo `cwd` está num repositório git, inclusive as do terminal e as de card.
- **O que mostra:**
  - o diff do working tree contra o `HEAD`, com os arquivos não rastreados;
  - nos cards, o diff contra a base, como na Fase 4.
- **Por arquivo:** status, inserções e remoções. O diff é lado a lado ou unificado.
- **Atualização:** ao vivo, por um watcher do `cwd` com debounce de 500 ms, e também pelo botão de atualizar.

### Comentários inline

- **Como se comenta:** selecione uma linha ou um intervalo no diff e escreva o comentário.
- **Rascunho:** os comentários ficam em rascunho, guardados no daemon:
  ```sql
  CREATE TABLE review_comments (id TEXT PRIMARY KEY, target TEXT, path TEXT, side TEXT, line_start INTEGER,
                                line_end INTEGER, quote TEXT, body TEXT, state TEXT, created_at TEXT, sent_at TEXT);
  ```
  O `target` é `session:<claudeSessionId>` ou `card:<id>`, e o `state` é `draft` ou `sent`.
- **"Enviar revisão":** monta uma mensagem com cada comentário:
  ```
  Revisão das mudanças:
  1. `src/a.ts` linhas 10–12:
     > <trecho citado>
     <comentário>
  ```
- **Para onde a revisão vai:**
  - sessão gerenciada ou de card: `session.send`;
  - sessão do terminal controlável: `external.message` (Fase 5);
  - sessão não controlável: "Copiar revisão".
- **Depois do envio:** os comentários enviados ficam marcados e continuam visíveis como histórico do card.
- **Diff que mudou depois do comentário:** o comentário fica ancorado no trecho citado. Se o trecho sumir, fica "desatualizado".

### Reverter e editar

- **"Reverter arquivo":** pede confirmação.
  - Arquivo rastreado: volta ao `HEAD`, ou à base no card, com `git restore --source`.
  - Arquivo novo: é removido.
  - Antes de reverter, o daemon grava uma cópia em `<dataDir>/review-trash/`, com retenção de 7 dias, e oferece "Desfazer" por 30 s.
- **"Editar":** abre o arquivo num editor de texto simples (CodeMirror 6), dentro da worktree ou do `cwd`.
  - Salvar só grava se o arquivo não mudou desde que foi aberto, comparando hash. Se mudou, mostra o conflito.
  - Só vale para arquivos de texto até 1 MB.

### Comentários do PR para o agente

- **Busca:** nos cards com PR aberto, o daemon busca os comentários de revisão:
  - GitHub: `gh api repos/{owner}/{repo}/pulls/{n}/comments` e o review summary;
  - Azure DevOps: `az repos pr thread list`.
- **Quando busca:** no mesmo intervalo do `board.prPollIntervalMs`.
- **Onde aparecem:** na aba Mudanças do card, com arquivo, linha, autor e estado (resolvido ou não).
- **"Enviar ao agente":** manda os selecionados para a sessão do card, no mesmo formato da revisão inline. Nada é postado de volta no provedor.

### Merge local e posição da worktree

- **Indicador no card:** "N à frente, M atrás" da base, por `git rev-list --left-right --count <base>...<branch>`.
- **"Atualizar com a base":** rebase da branch do card sobre a base. Se houver conflito, aborta o rebase, avisa com a lista de arquivos e deixa a worktree como estava.
- **"Merge e arquivar":** para cards sem PR. Modos: `merge --no-ff` (padrão) ou `squash`.
  1. **Se a base está em checkout em alguma worktree** (o caso comum: o `main` aberto no repositório principal), o merge é feito **ali**, com `git merge` ou `git merge --squash` + commit. Isso só acontece se aquela worktree estiver limpa. Com mudanças nela, recusa com a lista de arquivos.
  2. **Se a base não está em checkout em nenhuma worktree**, o merge é feito numa worktree temporária da base, que é removida em seguida.
  3. **Nunca mova o ref de uma branch em checkout** (`update-ref` ou `merge-tree`), porque o índice e os arquivos daquela worktree ficariam para trás do HEAD.
  4. Remove a worktree e a branch do card e leva o card a Concluído.
- **Merge com conflito:** recusa, avisa e não muda nada.

### `.worktreeinclude`

- **O arquivo:** `.worktreeinclude` na raiz do repositório, com padrões no formato do `.gitignore` (por exemplo `.env`, `.env.local` ou `config/*.secret.json`).
- **Cópia:** ao criar a worktree de um card, o daemon copia do repositório principal os arquivos **ignorados pelo git** que casam com os padrões.
  - Arquivos rastreados já vêm com a worktree.
  - Limite de 50 MB no total. Acima disso, copia até o limite e avisa no card.
  - Nunca copia nada de `.git/` nem de `.flightdeck/`.
- **Junção com a Fase 7:** a cópia do `settings.local.json` passa a ser um caso desta, com o padrão embutido `.claude/settings.local.json`.

### Sessão ↔ arquivos

- **Fonte:** o indexador de histórico extrai, dos transcripts, os `tool_use` de `Write`, `Edit`, `MultiEdit` e `NotebookEdit`, com o `file_path`.
  ```sql
  CREATE TABLE session_files (claude_session_id TEXT, path TEXT, edits INTEGER, first_at TEXT, last_at TEXT,
                              PRIMARY KEY (claude_session_id, path));
  ```
- **No app:**
  - a sessão mostra os arquivos que tocou;
  - na aba Mudanças, cada arquivo tem "Sessões que mexeram aqui", com as sessões e as datas.
- **Limite:** mudanças feitas por `Bash` não entram, e o app diz isso.

### Statusline (`flightdeckd statusline`)

- **Uso:** comando para usar dentro da statusline do próprio usuário. **O Flightdeck nunca escreve a configuração de statusline.**
- **Leitura:** lê o JSON que o Claude Code passa no stdin, pega o `session_id` e o `cwd`, e consulta o daemon local com timeout de 300 ms.
- **Saída:** uma linha, por exemplo `5h 35% · 7d 27% · hoje $4.20 · sessão $0.84`.
- **Sem daemon:** com o daemon fora do ar ou lento, imprime uma linha vazia e sai com 0.
- **README:** mostra como somar o comando a uma statusline existente.

### Protocolo (só adições)

| Item | Tipo | Conteúdo |
| --- | --- | --- |
| `changes.get` | comando | `target`; arquivos com status, diff e, no card, à frente e atrás |
| `changes.watch` / `changes.updated` | comando / frame | diff atualizado depois de mudança no disco |
| `changes.revert` / `changes.undoRevert` | comando | `target`, `path`, `confirm` |
| `file.read` / `file.write` | comando | `target`, `path`; `write` com `expectedHash` |
| `review.list` / `review.add` / `review.update` / `review.remove` / `review.send` | comando | comentários do alvo; `send` manda os rascunhos e devolve para onde foram |
| `pr.comments` | comando | `cardId`; comentários do PR |
| `pr.comments.send` | comando | `cardId`, `ids` |
| `card.updateFromBase` / `card.mergeLocal` | comando | `cardId`; `mergeLocal` com `mode` e `confirm` |
| `files.sessions` | comando | `path` absoluto; sessões que mexeram no arquivo |
| `statusline.get` | comando | `claudeSessionId?`; os dados da linha |

### App

- Aba **Mudanças** na sessão e no card:
  - lista de arquivos, diff com seleção para comentar, rascunhos ao lado e "Enviar revisão";
  - por arquivo: "Reverter", "Editar" e "Sessões que mexeram aqui".
- No card:
  - comentários do PR com "Enviar ao agente";
  - indicador à frente e atrás, "Atualizar com a base" e "Merge e arquivar".
- Na configuração do projeto: um aviso quando não existe `.worktreeinclude`, com um exemplo.

## Migrações com trilhas em paralelo

Várias fases criam tabelas ao mesmo tempo. A regra:

- cada uma acrescenta as próprias migrações no fim do array;
- no rebase sobre a fase integrada anterior, renumera as suas para depois das que já entraram;
- nenhum teste fixa o índice de uma migração.

## Disciplina TDD

Segue [`docs/TDD.md`](TDD.md). A auditoria vai desde o commit-base da fase, a tag da fase anterior integrada.

**Travas:**
- Os repositórios dos testes são temporários e usam o helper de tempdir com realpath.
- `gh` e `az` são os falsos da Fase 4.
- O statusline é testado com o stdin falso e um daemon de teste.

## Testes e critérios

| Área | O que precisa passar |
| --- | --- |
| `mudancas` | diff contra `HEAD` com não rastreados; card contra a base; watcher com debounce; arquivo binário marcado sem diff |
| `revisao-inline` | comentários em rascunho por alvo; envio monta a mensagem no formato e vai pelo caminho certo (gerenciada, card, terminal controlável ou copiar); comentário fica desatualizado quando o trecho some |
| `reverter-editar` | revert de rastreado e de novo com cópia e desfazer; edição com `expectedHash`; conflito quando o arquivo mudou; limites de texto e tamanho |
| `pr-comentarios` | GitHub e Azure pelos falsos; estado resolvido; envio ao agente; nada postado no provedor |
| `merge-local` | à frente e atrás; atualizar com a base com e sem conflito (aborta e preserva); merge `--no-ff` e `squash` com a base em checkout limpo, conferindo que o `git status` daquela worktree fica limpo depois; base em checkout com mudanças é recusada; base fora de checkout pela worktree temporária; conflito recusa sem mudar nada |
| `worktreeinclude` | copia só os ignorados que casam; limite de 50 MB; nunca `.git` nem `.flightdeck`; `settings.local.json` como padrão embutido |
| `sessao-arquivos` | `Write`, `Edit`, `MultiEdit` e `NotebookEdit` extraídos de fixture; deduplicação por mensagem; `files.sessions` |
| `statusline` | linha com cota e custo; daemon fora do ar dá linha vazia e saída 0 em menos de 300 ms; nada é escrito em settings |
| `mudancas-ui` | aba com lista, diff, seleção e rascunhos; reverter com confirmação e desfazer; editor com conflito |
| `card-revisao-ui` | comentários do PR; à frente e atrás; atualizar e merge com confirmação e mensagens de conflito |

**Smoke (`bun run smoke:review`)**

- Daemon `--runtime fake` e um repositório temporário com remoto local, um `.worktreeinclude` e um `.env` ignorado.
- O card é criado e o `.env` aparece na worktree.
- O fake edita dois arquivos.
- Um comentário inline é enviado e chega à sessão do card no formato certo.
- Um arquivo é revertido, e o desfazer o recupera.
- "Merge e arquivar" com `squash` leva o card a Concluído, a base ganha um commit e a worktree some.
- Imprime `SMOKE REVIEW OK`.

**Critérios de aceite**

- [ ] O vermelho por asserção de cada área mostrado antes da implementação.
- [ ] `tdd:audit` OK desde o commit-base.
- [ ] typecheck, lint e test com cobertura de 100%.
- [ ] Todos os smokes, inclusive o `smoke:review`.
- [ ] Os builds e o `cargo check` passam.
- [ ] CI verde.
- [ ] Versões em `0.10.0`.
- [ ] README atualizado.
- [ ] `docs/DECISIONS.md` atualizado e git limpo.
- [ ] Tag `fase-10` criada pelo orquestrador.

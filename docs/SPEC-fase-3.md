# Flightdeck — Spec da Fase 3 (Histórico)

## Objetivo e escopo

A Fase 3 traz para o Flightdeck as sessões que nasceram fora dele (terminal, VS Code, Desktop), lendo os transcripts do Claude Code em cada host, com busca e retomada.

Pré-requisito: Fase 2 fechada.

**Dentro da Fase 3**

- Indexador incremental dos arquivos JSONL em `~/.claude/projects/` de cada host.
- Leitura tolerante do formato: tipos desconhecidos são guardados crus, nunca derrubam o indexador.
- Busca de texto completo em mensagens do usuário e do assistente, com filtros por pasta e período.
- Visualização somente leitura de qualquer transcript indexado.
- Retomar uma sessão externa dentro do Flightdeck (vira sessão gerenciada com `resume`).
- Busca global no app, consultando todos os hosts e juntando os resultados.
- Atalho global do Windows para abrir a busca.

**Fora da Fase 3**

- Editar ou apagar transcripts do Claude Code: o Flightdeck só lê `~/.claude`.
- Controlar uma sessão externa que ainda está rodando em outro lugar.
- Busca semântica ou por embeddings.
- Copiar transcripts entre hosts.

## Design

O daemon de cada host indexa os próprios transcripts; o app consulta todos e junta os resultados.

### Formato dos transcripts

O JSONL do Claude Code é interno e muda entre versões, então o parser trata tudo como melhor esforço.

- Cada arquivo `<id>.jsonl` é uma sessão; o id do arquivo é o `claudeSessionId`.
- A pasta do projeto vem do campo `cwd` das linhas, nunca da decodificação do nome do diretório.
- Tipos conhecidos (mensagem de usuário, de assistente, resumo, sistema) viram registros normalizados; qualquer outro tipo é guardado cru e ignorado na busca.
- Linha que não é JSON válido é contada como erro de parse e pulada.
- Os fixtures de teste são trechos reais anonimizados, versionados em `apps/daemon/test/fixtures/history/`.

### Indexador

1. No boot, varre `history.roots` (padrão `["~/.claude/projects"]`), pulando pastas que casem com `history.excludeCwds`.
2. Para cada arquivo guarda caminho, tamanho, mtime e o offset em bytes até a última quebra de linha lida.
3. Mudanças chegam por observação do sistema de arquivos onde houver suporte e por varredura a cada 10 s como reserva.
4. Só lê a partir do offset salvo; uma última linha sem quebra fica para a próxima leitura.
5. Arquivo menor que o offset (truncado ou trocado) é reindexado do zero.
6. `flightdeckd history reindex` apaga o índice e reconstrói.

Sessões criadas pelo próprio Flightdeck também geram transcript; quando o `claudeSessionId` bate com uma sessão gerenciada, a origem fica `flightdeck` em vez de `external`.

### Busca

- O texto indexado é o das mensagens de usuário e assistente, mais uma linha `[ferramenta Nome]` por chamada de ferramenta; resultados de ferramenta não entram. Cada mensagem é cortada em 8 KB.
- Usa FTS5 do SQLite. No boot o daemon verifica se o FTS5 está disponível; se não estiver, cai para busca com `LIKE` e registra a decisão.

### Retomada

- Uma sessão é marcada `maybeActive` se o arquivo mudou nos últimos 2 minutos.
- `history.resume` cria uma sessão gerenciada com `resume` apontando para o `claudeSessionId`. Se a sessão estiver `maybeActive`, exige `force: true`, porque dois processos escrevendo na mesma sessão corrompem a conversa.

### Dados

```sql
CREATE TABLE history_files    (path TEXT PRIMARY KEY, claude_session_id TEXT, size INTEGER, mtime TEXT, offset INTEGER, parse_errors INTEGER);
CREATE TABLE history_sessions (claude_session_id TEXT PRIMARY KEY, cwd TEXT, title TEXT, first_ts TEXT, last_ts TEXT,
                               message_count INTEGER, origin TEXT, file_path TEXT);
CREATE TABLE history_messages (claude_session_id TEXT, uuid TEXT, ts TEXT, role TEXT, kind TEXT, text TEXT,
                               PRIMARY KEY (claude_session_id, uuid));
CREATE VIRTUAL TABLE history_fts USING fts5(text, content='history_messages');
```

O `title` é o resumo do Claude quando existir, senão a primeira mensagem do usuário cortada em 120 caracteres.

### Protocolo (só adições)

| Item | Tipo | Conteúdo |
| --- | --- | --- |
| `history.list` | comando | filtros `cwd?`, `from?`, `to?`, `origin?`, `limit`, `cursor` → resumos |
| `history.get` | comando | `claudeSessionId`, `cursor`, `limit` → mensagens normalizadas, paginadas |
| `history.search` | comando | `query`, `cwd?`, `from?`, `to?`, `limit` → acertos com `snippet`, `ts`, `cwd` |
| `history.resume` | comando | `claudeSessionId`, `name?`, `permissionMode?`, `force?` → `sessionId` |
| `history.watch` | comando | passa a receber `history.changed` |
| `history.changed` | evento | `claudeSessionId`, `cwd`, `lastTs`, `maybeActive` |

## App desktop

O histórico vira uma área própria do app, separada das sessões ativas.

- **Histórico por host:** lista de sessões indexadas com título, pasta, data da última mensagem, origem (`flightdeck` ou `external`) e selo "possivelmente em uso"; filtros por pasta, período e origem.
- **Busca global:** `Ctrl+K` abre uma busca que consulta `history.search` em todos os hosts online em paralelo, junta por data e mostra host, pasta e trecho destacado. Host offline aparece como "sem resposta" sem travar o resultado.
- **Leitor de transcript:** somente leitura, mesmo visual do chat, carregando em páginas conforme a rolagem; abre no ponto do acerto quando vem da busca.
- **Retomar:** botão "Continuar no Flightdeck" (cria a sessão gerenciada) e "Copiar comando" (copia `claude --resume <id>` para usar no terminal). Se a sessão estiver possivelmente em uso, o app pede confirmação antes de mandar `force: true`.

### Atalho global

A busca fica a um atalho de distância mesmo com o app em segundo plano, pelo plugin de atalho global do Tauri 2, sempre através da camada `platform`.

- O atalho é configurável, com padrão `Ctrl+Alt+F`. Ele traz o app para frente com a busca global aberta.
- O `Ctrl+K` continua valendo dentro do app, mas nunca como atalho global, porque colide com o navegador e o VS Code.
- Se o registro falhar porque outro programa já usa o atalho, o app avisa e abre a configuração para escolher outro.

## Disciplina TDD

Toda funcionalidade desta fase nasce de um teste que falha, e o histórico do git precisa provar isso.

1. Para cada área da tabela de testes, e para qualquer comportamento novo fora dela, escreva primeiro o teste e rode só esse arquivo com `bun test <arquivo>`. Mostre a falha, e ela precisa ser pelo motivo certo: uma asserção, não erro de import, sintaxe ou tipo.
2. Commit só com o teste: `test(<área>): <comportamento>`, com a área em kebab-case (por exemplo `parser`, `incremental`).
3. Escreva a implementação mínima, rode o mesmo arquivo e mostre o verde. Commit `feat(<área>): ...`.
4. Refatoração só com a suíte inteira verde, em commit `refactor(<área>): ...`.
5. Bug achado depois: primeiro o teste que reproduz, depois a correção em `fix(<área>): ...`.
6. Os smokes também começam vermelhos: o script é escrito e roda falhando antes da implementação que ele cobre.
7. Proibido: implementação antes do teste da área, enfraquecer ou apagar asserção para passar, e `.only`, `.skip` ou `test.todo` no código commitado.

A auditoria `bun run tdd:audit -- --since fase-2` (criada na Fase 2) confere a ordem dos commits e a ausência de testes desligados.

## Testes, critérios e /goal

Os testes rodam contra uma pasta temporária que imita `~/.claude/projects`, montada a partir dos fixtures; o `~/.claude` real nunca é lido nos testes.

**Áreas de teste (cada uma entra no TDD e na auditoria)**

| Área | O que precisa passar |
| --- | --- |
| `parser` | fixtures de cada tipo conhecido viram registros normalizados; tipo desconhecido é guardado cru; linha inválida conta erro e não derruba |
| `incremental` | acrescentar linhas indexa só as novas; linha sem quebra final espera a próxima leitura |
| `truncamento` | arquivo menor que o offset é reindexado do zero |
| `exclusoes` | pasta em `history.excludeCwds` não entra no índice |
| `origem` | sessão com `claudeSessionId` gerenciado recebe origem `flightdeck` |
| `busca` | termo presente acha a mensagem certa com snippet; filtros de pasta e período funcionam; fallback sem FTS5 devolve o mesmo acerto |
| `retomada` | sessão `maybeActive` recusa sem `force`; com `force` cria sessão gerenciada com `resume` |
| `reindex` | `history reindex` reconstrói o índice com a mesma contagem de mensagens |
| `atalho-global` | a configuração valida o formato e recusa `Ctrl+K` e combinações sem modificador; falha de registro na implementação falsa da `platform` leva ao aviso e à tela de configuração |

**Smoke (`bun run smoke:history`)**

Cria a pasta temporária com dois transcripts, sobe o daemon `--runtime fake` apontando para ela, espera a indexação, busca um termo que só existe no segundo, retoma essa sessão e confere que o `FakeRuntime` recebeu o `resume` com o id certo. Depois acrescenta uma linha ao primeiro transcript e confere o `history.changed`. Imprime `SMOKE HISTORY OK`.

**Critérios de aceite**

- [ ] Para cada área da tabela acima, a conversa mostra o teste falhando antes da implementação e passando depois.
- [ ] `bun run tdd:audit -- --since fase-2` imprime `TDD AUDIT OK`.
- [ ] `bun run typecheck`, `bun run lint` e `bun test` saem com código 0.
- [ ] `bun run smoke`, `bun run smoke:multi` e `bun run smoke:history` imprimem `SMOKE OK`, `SMOKE MULTI OK` e `SMOKE HISTORY OK`.
- [ ] `bun run build:daemon`, `bun run build:desktop` e `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` saem com código 0 (o último no Windows nativo).
- [ ] README explica o que é indexado, como excluir pastas, como reconstruir o índice e como mudar o atalho global.
- [ ] Divergências registradas em `docs/DECISIONS.md`, `git status` limpo e a tag `fase-3` criada.

**Condição do /goal**

```text
/goal A Fase 3 de docs/SPEC-fase-3.md está implementada em TDD e, nesta conversa, você mostrou a saída real de: (1) para cada área da tabela de testes (parser, incremental, truncamento, exclusoes, origem, busca com e sem FTS5, retomada, reindex e atalho-global), o bun test do arquivo da área falhando por asserção antes da implementação e passando depois; (2) bun run tdd:audit -- --since fase-2 imprimindo TDD AUDIT OK; (3) bun run typecheck, bun run lint e bun test saindo com código 0; (4) bun run smoke, bun run smoke:multi e bun run smoke:history imprimindo SMOKE OK, SMOKE MULTI OK e SMOKE HISTORY OK; (5) bun run build:daemon, bun run build:desktop e cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml saindo com código 0, este último no Windows nativo; (6) git status sem alterações pendentes e git tag listando fase-3. Nenhum teste leu o ~/.claude real nem usou o Claude real.
```

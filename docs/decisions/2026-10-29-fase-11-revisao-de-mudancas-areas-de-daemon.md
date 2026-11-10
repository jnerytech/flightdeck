# Decisões e divergências da Fase 11 (revisão de mudanças), áreas de daemon e protocolo (phase 11)

## Alvos e permissões

- **De onde vem a pasta:** do que o daemon registrou, nunca do cliente.
  - Na ordem: a sessão gerenciada, a sessão do terminal, o histórico e a worktree do card.
  - O alvo da sessão é o topo do repositório que contém o `cwd`, então uma sessão aberta numa subpasta vê o repositório inteiro.
- **Leitura e escrita:** a spec quer a aba Mudanças em "toda sessão… inclusive as do terminal", que costumam ficar fora de `allowedRoots`.
  - `changes.get`, `changes.watch` e `file.read` valem para qualquer alvo resolvido.
  - Revert, desfazer e `file.write` exigem `allowedRoots` e respondem `forbidden_cwd` fora deles.
  - O arquivo, com os links resolvidos, precisa continuar dentro do repositório.
  - O caminho é sempre relativo, sem `..` e fora do `.git`.
- **`host.info`:** anuncia `review` quando o daemon tem as mudanças.

## Mudanças

- **Watcher:** a janela é de 500 ms contados a partir da primeira mudança, e não reinicia a cada evento.
  - Eventos em `.git` e `.flightdeck` não contam, porque o próprio `git diff` escreve no `.git/index`.
  - O watcher é por conexão e por alvo (`changes.unwatch`, ou o fechamento da conexão), e uma falha do diff depois de um evento vai para o log.
- **Repositório sem commit:** o diff é contra a árvore vazia do git.
- **Card:** o `changes.get` traz `position` (à frente e atrás da base), em vez de um campo novo no card, porque a contagem custa uma chamada ao git.

## Comentários inline

- **Trecho:** o daemon lê do próprio arquivo: o lado `new` é o arquivo atual, o lado `old` é o `HEAD` ou a base do card.
- **Âncora:** é refeita a cada `review.list`, na ocorrência do trecho mais próxima da linha original. A nova posição fica gravada.
  - Sem o trecho, o comentário fica `outdated` e guarda a última posição conhecida.
  - Um alvo que não resolve mais (card concluído, repositório apagado) deixa os comentários na lista, como histórico desatualizado.
- **Envio:** o `review.send` marca os rascunhos como `sent` depois da entrega.
  - No caminho "copiar", o app recebe o texto para entregar à mão, e a revisão conta como enviada também.
- **Formato:** cada item tem o número, o arquivo e a linha (ou as linhas, com –), o trecho com `> ` e o comentário, com três espaços de recuo.
- **Terminal:** o `external.message` e a revisão usam a mesma função de entrega pelo canal (`messageExternal`).

## Reverter e editar

- **Fonte:** o `HEAD`, ou a base do card. Um arquivo que a fonte não tem (novo, ou criado num commit do card) é removido e sai do índice.
- **Desfazer:**
  - volta o conteúdo da cópia e põe o índice daquele caminho de novo no `HEAD`;
  - um revert de arquivo apagado é desfeito apagando-o de novo;
  - mudanças que já estavam staged antes do revert voltam como não staged;
  - o registro fica em memória por 30 s e não sobrevive a um reinício (a cópia fica na lixeira por 7 dias).
- **Conflito na edição:** o novo código de erro `file_conflict` (só adição ao `ErrorCode`). O app lê o arquivo de novo com `file.read`.

## `.worktreeinclude`

- **Candidatos:** vêm do `git ls-files --others --ignored` com os padrões do arquivo mais o embutido `/.claude/settings.local.json`. Entre eles, só os que o `git check-ignore` confirma como ignorados.
- **Ordem e limite:** os arquivos são copiados em ordem de caminho até o limite. Os que passariam dele ficam de fora, com aviso no card. O limite pode ser trocado só nos testes (`worktreeIncludeLimit`).
- **Fase 7:** a cópia do `settings.local.json` agora é um caso desta, com a mesma regra de nunca copiar um arquivo versionado (ele já vem com a worktree).
- **Projeto:** ganha `worktreeInclude` (só adição), para o app avisar quando falta.

## Merge local

- **Conflito:** é conferido antes com `git merge-tree --write-tree`, que só lê. Com conflito, nada muda.
- **Base em checkout:** o merge é feito na worktree que tem a base, e só se ela estiver limpa.
- **Base fora de checkout:** o merge vai por uma worktree temporária em `.flightdeck/worktrees/`, removida no fim.
- **Nunca mover ref à mão:** nenhuma ref é movida com `update-ref`.
- **Recusas além da spec:**
  - sem `confirm`;
  - card com PR;
  - card em execução (fila, starting, running ou aguardando aprovação), também para "Atualizar com a base";
  - worktree do card com mudanças não commitadas;
  - nada à frente da base;
  - base que não é uma branch local.
- **Depois do merge:** ele já está na base e não se desfaz, então nada abaixo deixa o card fora de Concluído.
  - Se a pasta da worktree não sai (travada, ou segurada por um processo no Windows), o card vai para Concluído com o aviso "a pasta da worktree ficou em <caminho>; remova depois", e mantém o caminho e a branch.
  - Se só a branch não sai (em checkout em outra worktree), o aviso diz qual branch ficou, e o card perde só o caminho da worktree.
  - Nos testes, a pasta que não sai é uma worktree travada com `git worktree lock`, e a branch que não sai está em checkout em outra worktree.
- **Mensagem do commit:** no squash, o título do card; no `--no-ff`, `Merge <branch>: <título>`.
- **Ordem da limpeza:** a worktree sai antes da branch, porque o git não apaga uma branch em checkout.
- **Atualizar com a base:** `git rebase --autostash`. No conflito, o `rebase --abort` devolve também as mudanças não commitadas.

## Comentários do PR

- **Azure DevOps:** a spec cita `az repos pr thread list`, mas a referência oficial do `az repos pr` (extensão azure-devops) não tem subcomandos de thread.
  - O daemon usa `az devops invoke --area git --resource pullRequestThreads`, uma leitura (GET).
  - Organização, projeto, repositório e número vêm da URL do PR.
  - Thread resolvida: status `fixed`, `closed`, `wontFix` ou `byDesign`. Comentários do sistema e threads apagadas ficam de fora.
- **GitHub:**
  - os comentários vêm do REST (`gh api repos/{o}/{r}/pulls/{n}/comments`) e os resumos, do `gh pr view --json reviews`, só os que têm texto;
  - o estado resolvido vem de uma consulta GraphQL (`reviewThreads.isResolved`), porque o REST não informa;
  - a consulta vai pelo stdin (`-F query=@-`), porque os caracteres dela não passam por um `.cmd` no Windows, como o `gh` falso dos testes;
  - os comentários do REST vêm de todas as páginas, 100 por vez: `gh api --paginate --slurp "repos/{o}/{r}/pulls/{n}/comments?per_page=100"` (um array de páginas, que o daemon junta). O `per_page` vai no caminho e não em `-F`, porque um campo faria o `gh api` mudar para POST. O `--slurp` pede o `gh` 2.48 ou mais novo;
  - o corte que sobra é o da consulta GraphQL: `reviewThreads(first: 100)` e `comments(first: 100)` por thread. Passando disso, os comentários além do corte aparecem como não resolvidos;
  - o `gh api graphql` faz um POST mesmo para consulta. O teste de "nada postado" confere o conteúdo das chamadas: nenhum `mutation`, `-X`, `--method`, `pr comment` ou `pr review`.
- **Autoria:** o `PrComment` traz quem escreveu, para as automações da Fase 13 ignorarem comentários de fora e o app marcá-los.
  - `authorAssociation`: o `author_association` do GitHub (OWNER, MEMBER, COLLABORATOR, CONTRIBUTOR, NONE…), nos comentários e nos resumos das revisões. É nulo no Azure.
  - `authorIdentity`: o `uniqueName` do Azure, ou o id quando não há. É nulo no GitHub.
- **Segurança dos argumentos (texto de terceiros e `@`):** o `gh api -F campo=@arquivo` lê o arquivo, e `-F campo=@-` lê o stdin; o `az` troca pelo conteúdo do arquivo todo argumento que começa com `@` e todo `nome=@arquivo`. O `-f` do `gh` manda o valor como ele é.
  - Nenhum texto de terceiros (corpo de comentário, título) vai ao `gh` ou ao `az` na Fase 11: os comentários só são lidos e seguem para a sessão do agente como texto. Um teste confere que `@/etc/passwd` e `campo=@arquivo` chegam literais ao agente.
  - O que vem da URL do PR é o que entra em argumentos: dono, repositório e projeto. Os três passam por uma checagem depois de decodificar (um `%40` vira `@`): o que começa com `@`, ou tem quebra de linha ou outro caractere de controle, é recusado com `invalid_state` antes de qualquer chamada.
  - No `gh`, a URL do PR vai reconstruída (`https://github.com/<dono>/<repo>/pull/<n>`), nunca como foi guardada. `owner` e `name` do GraphQL vão por `-f`, e só a consulta fixa (`query=@-`, do stdin, que é nossa) e o número (só dígitos, o `Int!` da consulta) vão por `-F`. Um teste lista todos os valores de `-F` das chamadas.
  - Achado junto: na consulta GraphQL, uma edição minha tinha comido o `-F` que vinha antes de `owner=`, e o argumento ficou solto. O `gh` real recusa (`accepts 1 arg(s), received 2`), e o falso aceitava. Os argumentos exatos da chamada agora estão num teste, e a forma nova foi conferida contra o `gh` real (lê a consulta do stdin e responde).
- **Nomes na URL do Azure:** projeto e repositório saem da URL do PR com as sequências `%20` decodificadas, porque a API quer o nome como ele é. No Windows o `%` quebra um `.cmd` (o Bun recusa o argumento), então um projeto com espaço no nome não funcionava.
- **Texto livre no `az`:** a Fase 11 não manda nenhum. Os argumentos do `az devops invoke` são o projeto, o repositório e o número do PR, que vêm da URL, mais a organização e a versão da API. Se isso mudar, vale o helper da área `az-cmd` da dev (uma linha, sem `< > & | ^ " %`, até 400 caracteres).
- **Busca e cache:** a busca acontece na rodada de poll do PR, enquanto ele está aberto. Uma falha guarda os últimos comentários e não mexe no aviso do card. O `pr.comments` busca na hora quando ainda não há nada.
- **Formato do envio:** "Comentários do PR:", e cada item com o arquivo e a linha (ou "revisão de <autor>") seguido do texto.

## Sessão ↔ arquivos

- **Onde é lido:** pelo indexador de uso da Fase 8, que já lê todos os transcripts, subagentes inclusive (atribuídos à sessão-mãe).
- **Ferramentas:** `Write`, `Edit` e `MultiEdit` pelo `file_path`, e `NotebookEdit` pelo `notebook_path`.
- **`edits`:** é o número de chamadas de ferramenta, deduplicadas pelo id do `tool_use`, guardado na `session_file_edits` (além da spec). Uma linha repetida ou um arquivo relido conta uma vez.
- **Arquivos antigos:** a migração limpa a `usage_files` e o indexador relê tudo no boot, o que traz os arquivos dos transcripts que já existiam.
  - O uso continua deduplicado por `message_id`.
  - Entradas de uso mais antigas que `retention.usageDays`, que a limpeza já tinha tirado, voltam até a limpeza seguinte (no boot e a cada 24 h).
- **Comparação de caminhos:** o `files.sessions` compara os caminhos como as pastas da Fase 3, com barras normalizadas e sem diferenciar maiúsculas no Windows e no macOS.
- **`session.files`:** comando além da spec, para "a sessão mostra os arquivos que tocou".

## Statusline

- **Config:** é só lida, sem nunca ser criada. Sem config, a linha sai vazia.
- **Prazo:** o comando espera no máximo 250 ms por tudo, do stdin à resposta, para a linha sair em menos dos 300 ms do critério também quando o daemon não responde. O teste confere os 300 ms mesmos. Com o daemon mudo ou fora do ar, ou um stdin que não termina, a linha sai vazia e o código é 0.
- **Partes:** as janelas da cota em `5h` e `7d` (outras pelo nome), o custo de hoje no fuso do host e o custo da sessão, este só quando ela tem uso.

## TDD e testes

- **Vermelho do `smoke:review`:**
  - foi escrito depois das áreas e falhou na primeira execução, no passo do merge, por dois motivos do próprio script: o turno da revisão (que cita o `[commit]` do fake) não tinha terminado, e o `autocrlf` do script divergia do daemon;
  - o vermelho de recurso veio rodando o script numa cópia da base `c998016`, com `SMOKE REVIEW FAIL no passo "card com .worktreeinclude"` e código 1.
- **`fix(reverter-editar)`:** o smoke também revelou que o desfazer não devolvia o índice. Isso entrou com um teste vermelho antes.
- **Commit de teste quebrado:** um commit `test(merge-local)` saiu com uma string partida pelo shell. O commit seguinte corrigiu, com o vermelho por asserção antes do `feat`.
- **Ramos revelados pela cobertura** seguiram a regra 7: o ramo saiu, o teste ficou vermelho e só então o ramo voltou.
  - Pasta da sessão que sumiu.
  - Cancelar o diff pendente com timers reais.
  - Falha do diff depois de um evento.
  - Alvo que não resolve mais.
  - Card sem worktree.
- **Base que não é branch local:** a checagem vai antes da contagem de commits, para a mensagem ser a do Flightdeck e não a do `git rev-list`.
- **Link para fora do repositório:** no teste é uma junção de diretório, que o Windows cria sem privilégio. Assim a recusa é conferida nas duas pernas.
- **Testes sensíveis a tempo:** com a CI bloqueando nas duas pernas, o watcher real do `mudancas` usa uma janela de 1 s para parar com um diff pendente (eram 20 ms contra um stop 10 ms depois da escrita).
- **Base por prefixo:** a worktree que tem a base em checkout era achada por prefixo (`dev` casava com `develop`). Agora a linha inteira `branch refs/heads/<base>` é comparada, com um teste vermelho antes.
- **Rebase:** a fase foi rebaseada sobre a tag `fase-9` (59967a8) sem conflito de código, só nos documentos. A auditoria vai desde `fase-9`.

# Decisões e divergências da Fase 17 (daemon, protocolo, MCP e smoke) (phase 17)

O que a spec da Fase 17 (o Claude usa o segredo sem vê-lo) deixou aberto, ou o que mudou na implementação. Nesta rodada entrou o lado do daemon: `acoes-schema`, `acoes-execucao`, `acoes-confianca`, `mascara`, `mcp-acoes` e o `smoke:actions`. The `flightdeck-actions` mod is described in "Phase 17 decisions: the interface". The actions screen (`acoes-ui`) and the `prod` warning were delivered later; see "Phase 17 decisions: the interface".

## Onde moram as ações

- **Do app:** a tabela `actions` do banco do daemon, por escopo (o id do projeto, ou vazio para o host). Salvar com o mesmo nome troca a definição. Nenhum valor de segredo entra nela, só as referências `{{secret.x}}`.
- **Versionadas:** `.flightdeck/actions.yaml`, lido da **branch base** com `git ls-tree` e `git show`, como os workflows, e nunca da worktree. Um arquivo com erro não derruba o resto: as ações válidas carregam e os erros voltam em `errors` do `actions.list`.
- **Nomes repetidos:** vale a primeira de: a do app no projeto, a versionada, a do app no host. Assim o usuário sobrepõe uma ação versionada sem editar o repositório.
- **Ações do host:** rodam na pasta home do host, a não ser que declarem `cwd`. O campo `host` da ação é só um rótulo: quem a guarda e a executa é o daemon do host dela.
- **Comandos do protocolo que a tabela da spec não listava:** `vault.watch`, `vault.deny` e `actions.runFree` (o `run_with_secret`). `actions.save` e `actions.remove` estão na spec só como "ações do projeto e do host".

## Confiança

- **O que a confiança fixa:** a declaração (sem o nome e a descrição, que o usuário pode mudar à vontade) e o sha256 do `run[0]` e de cada elemento do argv que é um arquivo existente dentro de um repositório git. Fica na tabela `action_trust`.
- **O app confia ao salvar:** a ação criada no app já nasce confiada, com os hashes de agora. Uma versionada nasce sem confiança e só roda depois do `actions.trust` com o hash da declaração que o usuário revisou (`hash` do `actions.list`). Se a declaração mudou nesse meio tempo, o `trust` falha.
- **Conferido duas vezes:** antes de pedir o segredo e **de novo logo antes de executar**, depois que o app aprovou. A aprovação pode levar minutos, e o agente pode mudar o script nesse intervalo. O segundo teste nasceu pela regra 7: sem a segunda conferência o teste "o script que muda enquanto o app decide" ficava vermelho.
- **O `changed` do `actions.list`:** diz o que difere do que foi confiado (`declaração` e/ou o caminho dos arquivos), para o app mostrar o diff. Uma ação com `changed` não vazio conta como não confiada, e confiar de novo é pelo `actions.trust`.
- **Fora do repositório:** um argumento que é um arquivo fora de um repositório git não entra na impressão (não há como saber se o agente o altera). Fica registrado como limite.

## De onde vem o segredo

- **A execução que o usuário inicia no app** (`requestedBy: "you"`) encontra os segredos já entregues, com o propósito `action:<nome>:you`. Sem a entrega, `not_found`, como no `vault.use`.
- **A que o Claude, uma automação ou um workflow inicia** faz o daemon pedir ao app, um segredo por vez: o frame `vault.request` leva o segredo, a ação, os parâmetros e o `approval`, e o app entrega pelo `vault.deliver`. **Cada entrega vale para um pedido só:** o propósito é `action:<nome>:<requestId>`, então um segredo entregue para outra coisa (ou pelo app para uma execução do próprio usuário) não é usado por um pedido do Claude.
- **O app responde de duas formas:** entrega (`vault.deliver`) ou recusa (`vault.deny`, comando que a spec não tinha, para o "não" do usuário falhar na hora em vez de esperar o prazo). O `vault.watch` liga o fluxo dos frames `vault.request` e `vault.used` na conexão, e a conexão que fecha deixa de receber.
- **Sem a quem pedir, falha na hora:** se nenhuma conexão assiste, o pedido falha com `invalid_state` sem esperar. Sem resposta, o prazo era de 2 minutos; a Fase 19 o levou a 10 (`requestTimeoutMs`). Parar o daemon cancela quem espera.
- **`approval`:** o daemon só repassa no frame o que a ação declara (`always`, `never` ou `first-per-session`, com o padrão da spec). **Quem decide perguntar ou não é o app**; o `first-per-session` depende da sessão do app. O daemon não executa nada sem a entrega, então um app que ignora o `approval` só pode entregar mais do que devia, nunca menos.
- **`decideRequest` mudou:** na Fase 16 negava tudo, "até as Fases 17 e 19". Agora um solicitante conhecido do daemon (`claude`, `automation`, `workflow`) é encaminhado ao app, que decide, e `you` ou o desconhecido continuam recusados. O teste `cofre-solicitante` foi corrigido antes do `feat`.
- **Registro de uso:** depois da execução o daemon manda um `vault.used` por segredo (`action: "run"`, propósito `action:<nome>` ou `run_with_secret`), sem o valor.

## `run_with_secret`

- **Sempre pede:** o frame leva `approval: "always"`, o comando exato, os nomes dos segredos e o host. O daemon só executa depois da entrega do app, e o risco do classificador para uma ferramenta MCP chamada `run_with_secret`, de qualquer servidor, é `high` e rede: a aprovação automática da Fase 13 nunca a aceita. Não existe "permitir sempre" aqui.
- **O comando:** vai para `sh -c`; no Windows, para um `.cmd` temporário (o `cmd /c` não desfaz as aspas que o Bun escapa no argv), apagado ao fim. Os segredos vão no ambiente como `NOME_EM_MAIUSCULAS` (`deploy-token` vira `DEPLOY_TOKEN`), nunca na linha.
- **Host:** absent or `local` is this host. Any other value is the name of a phase 15 ssh destino: the command runs there as `sh -c <command>`, with the secrets on stdin and the destino's vault key asked like the other secrets (see "Ações `ssh:`"). A daemon without destinos refuses it before asking the app anything.
- **Quem pode pedir:** só `claude`, `automation` e `workflow`. O protocolo nem aceita `you`.
- **Colisão de nomes:** dois segredos cujos nomes dão a mesma variável (`a-b` e `a_b`) escrevem na mesma variável. O pedido mostra os nomes dos segredos, não o das variáveis; fica como limite.

## Máscara e saída

- **Formas:** literal, escapado em JSON, base64 e base64url (com e sem `=`), URL-encode (maiúsculas e minúsculas, `+` para espaço) e hex (minúsculo e maiúsculo); um valor de várias linhas também por linha (linhas de pelo menos 6 caracteres). O que vira outra coisa (hash, rot13, cortado no meio) não é pego, e a documentação diz isso.
- **Antes de cortar:** o texto é mascarado inteiro e só depois cortado, para o corte nunca deixar meio segredo no fim. A saída volta com até 32 KB: 24 KB do stdout e 8 KB do stderr, lidos até 250.000 caracteres de cada um. O vermelho da divisão 24/8 foi um stderr perdido atrás de um stdout grande.
- **O banco guarda a saída já mascarada** (`action_runs`). Um teste procura o valor, em texto, base64, hex e URL, em todas as tabelas de ações.

## O mesmo usuário do sistema operacional

A garantia é que o segredo **nunca chega ao transcript nem ao contexto do modelo pelo Flightdeck**. Não é isolamento contra um processo hostil do mesmo usuário: enquanto a ação roda, as variáveis de ambiente (`/proc/<pid>/environ` no Linux) e o arquivo temporário do `{{secretFile.x}}` (qualquer ACL) podem ser lidos por outro processo do mesmo usuário, e uma sessão do Claude com Bash no mesmo host consegue. Segredos de produção devem ficar em ações `ssh:`, que rodam num host remoto sem shell para o Claude. O app mostra um aviso quando uma ação com segredo de tag `prod` roda no mesmo host de uma sessão do Claude com Bash (on the actions screen).

## Ações `ssh:`

O schema aceita `ssh: <destino>` (e recusa `{{secretFile}}` nelas) e o `runAction` chama um `SshExecutor` injetado. With phase 15 in place, the daemon wires `SshConnector.exec` into it:

- **The destino is found by name.** An unknown name is `not_found`, a name two destinos share is `invalid_state`, and a destino that logs in with a password is refused, since nobody is there to type it.
- **ssh does not keep argv as a list:** it joins the words of the remote command for the login shell. So the remote command is `sh -c '<prelude>' flightdeck-action <argv…>` with every word single-quoted (`'` becomes `'\''`), and it is passed to the local ssh as one argument. A round trip through `sh` shows `; rm -rf ~`, `$(id)`, backticks, spaces and quotes arriving as one literal word each. A login shell that is not POSIX-like (fish, for one) may read the quoting differently.
- **The environment goes over stdin**, never on a command line where it would show in the process list, here or on the remote host, and not through `SendEnv`, which stock `sshd` limits to `LANG` and `LC_*`. The prelude reads `NAME=value` lines up to an empty one, exports them and `exec`s the program. Names must be shell names, and a value with a line break, CR or NUL is refused for an ssh action.
- **ssh runs with** the pinned host keys of phase 15, `BatchMode=yes`, `ConnectTimeout=10` and `-T`. The action's timeout kills it.
- **A `vault-key` destino's key** is added to the secrets the run asks for, through the same `vault.request` and `vault.deliver`, so the delivery rules and the transport check (loopback or Tailscale only) apply. No other path carries a key. It is handed to the connector for that one run, taken away afterwards (also when ssh fails), and masked in the output like a secret.
- `smoke:actions` still has no ssh case: it would need a real sshd.

## MCP

- **Ferramentas novas:** `list_actions` (só as confiadas, com nome, descrição, `approval` e os parâmetros com padrão e default; nunca o `run`, o `env`, o hash nem o nome de um segredo), `run_action { name, params, projectId }` e `run_with_secret { command, secrets, host }`. O `requestedBy` é sempre `claude`: o MCP não consegue se passar por `you`.
- **Sem ferramenta para entregar um segredo:** ele continua só do app.

## Travas e testes

- **O que os testes procuram:** o `cofre-espera`, `acoes-servico`, `acoes-protocolo` e `acoes-mcp` conferem que o valor não aparece em nenhum frame, resposta ou tabela. O `smoke:actions` procura o valor, em texto, base64 e hex, nos arquivos do daemon, nos logs, no que o Claude falso recebeu e na própria saída.
- **Correções de teste antes do `feat` (regra 8):** o `cofre-solicitante` (pedido do daemon vai ao app) e a lista de ferramentas do `mcp` (de seis para nove).
- **Ramos revelados pela cobertura (regra 7):** a segunda conferência de confiança, antes de executar.
- **`smoke:actions`:** foi escrito depois das áreas. O vermelho veio por mutação, duas vezes: tirando a máscara (o valor aparecia na saída do `run_action`) e fazendo o pedido do comando livre devolver um valor sem esperar o app (`SMOKE ACTIONS FAIL no passo "run_with_secret sem aprovação não roda"`). Roda como o Claude Code roda: um `flightdeckd mcp` de verdade por stdio, com um cliente JSON-RPC mínimo no lugar do Claude.
- **Migração:** uma, no fim (`actions`, `action_trust` e `action_runs`). Nenhum teste fixa o índice dela.
- **App areas:** `acoes-ui` and the `prod` warning were delivered later, in the phase 17 interface round.

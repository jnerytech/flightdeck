# Decisões e divergências da Fase 16 (daemon e protocolo) (phase 16)

O que a spec da Fase 16 (cofre de segredos) deixou aberto, ou o que mudou na implementação. Nesta rodada só entrou o lado do daemon (`cofre-entrega` e `cofre-solicitante`); o keyring, as telas, o backup com `age` e a escolha dos hosts permitidos são do app e esperam a Fase 10.

## Nomes de sessão

- **Duas tabelas de verdade e uma de contadores.** `session_names` (o nome de cada sessão), `session_aliases` (todos os apelidos, únicos no host, os antigos de um renomear incluídos) e `session_name_counters` (só sobe). Apagar a linha de uma sessão não devolve o número, e o apelido continua reservado para ela.
- **O contador é pelo `slug` do projeto e da persona**, então `Meu App` e `meu-app` contam juntos e nunca geram o mesmo apelido. Se um renomear já tomou o apelido que o próximo número geraria, o número é pulado.
- **Card:** o número do card é por projeto e nasce na primeira sessão do card (`card 42`). A segunda sessão do mesmo card ganha o número de execução depois (`card 42 · 2`, apelido `…-card-42-2`), porque o apelido tem de ser único e um id é que identifica a sessão.
- **A persona chega de dois jeitos.** Já na primeira vista, por `personaOf` (as executoras: o card guarda a persona antes de iniciar, então a sessão nasce com ela). Depois, por `setPersona` (a coordenadora, e a persona trocada num membro em andamento): é um número novo sob a persona nova e o apelido de antes continua valendo. Um nome que o usuário deu não é trocado.
- **O nome padronizado é o nome que o messaging mostra** (`list_sessions`, o cabeçalho das mensagens). Os campos `name` de `session.list` e da meta seguem como eram: a lista do app só passa a mostrá-lo na Fase 10, com o `names.list`.
- **O id vence o apelido** quando os dois coincidem. Entre hosts, o app que ainda não manda apelidos continua endereçando por id.

## Entrega

- **Em memória e só nela:** o `Vault` do daemon guarda o valor num `Map`, com um temporizador por segredo. Nenhuma tabela, arquivo ou linha de log recebe o valor. O `vault.deliver` e o `vault.use` não gravam nada.
- **Prazo:** `expiresAt` (milissegundos desde a época) é cortado em 60 s a partir de agora; um prazo que já passou é recusado. Passado o prazo o valor some sozinho (temporizador) e, por garantia, quem tenta usar um valor vencido não o encontra.
- **Reentrega:** entregar de novo o mesmo segredo troca o valor e o prazo, sem ocupar outra vaga. No máximo 64 segredos de cada vez, para que um cliente local não encha a memória do daemon.
- **Uso:** `vault.use { secretId, purpose, action }` roda uma ação do daemon com o valor e o **descarta**. A finalidade tem de ser a da entrega, e a ação tem de existir; um erro nesses dois não gasta o valor. Uma ação que falha não repassa a mensagem do erro (ela poderia trazer o valor), só diz que falhou.
- **Sem app, sem segredo:** quando não há nada em memória, o uso falha com `not_found` e diz que o cofre é do app, que precisa estar aberto para entregar.
- **`vault.used`:** depois de cada uso o daemon manda ao cliente o frame com segredo, finalidade, solicitante, ação e hora, para o registro de uso do app. Nunca leva o valor.
- **A spec fala em "comando daemon → app" para o `vault.used`:** no protocolo atual o app é o cliente, então ele é um frame do daemon.
- **A ação `echo`:** a única que existe, e só com `--runtime fake`. Devolve o SHA-256 do valor e nunca o valor, para o smoke conferir que o daemon usou o valor certo. Um daemon com o runtime real não tem nenhuma ação: o `vault.use echo` é recusado e o segredo não é gasto. Nesta fase não há como ler um segredo de volta de um daemon.
- **O comando `vault.use` não está na tabela da spec.** Ele existe para que o uso aconteça num daemon que é um processo separado. As Fases 15 e 17 vão registrar ações de verdade (ssh, ações do Claude), e o `vault.use` é o gatilho de um uso que o app inicia.

## Transporte

- **O daemon confere também:** além do app, o daemon só aceita `vault.deliver` de uma conexão cuja origem (o endereço que o filtro de rede já olha) esteja no loopback (`127.0.0.0/8`, `::1`) ou nas faixas da Tailscale (`100.64.0.0/10`, `fd7a:115c:a1e0::/48`). É uma defesa em profundidade: o transporte cifrado é exigido, não presumido.
- **Recusa:** qualquer outra origem, por exemplo uma LAN em `allowedNetworks` com `ws` sem TLS, recebe `invalid_state` com o motivo, e o daemon registra a recusa com a origem e o id do segredo, **sem o valor**.
- **Teste de rede de verdade:** quando a máquina tem uma interface que não é loopback nem Tailscale, o teste sobe o daemon nela e entrega por ali.

## Solicitante

- **`you` só para o que o app iniciou.** Um pedido que vem do daemon é `claude`, `automation` ou `workflow`; qualquer outra coisa, `you` inclusive, e a ausência dele, vale `unknown`, o mais restrito.
- **Todo pedido do daemon é negado nesta fase** (`decideRequest`), com o motivo (a Fase 17 mudou isto: ver abaixo). Não há nenhum caminho que emita o frame `vault.request`; o schema dele só aceita os três solicitantes do daemon, então um frame que diga `you` nem é um pedido válido (o app o trata como desconhecido).
- **O que o pedido `you` do daemon não consegue:** qualquer processo local que leia o `~/.flightdeck/config.json` fala o protocolo, mas não tem como fazer o daemon pedir um segredo ao app em nome de `you`.

## Travas e testes

- **Procura do valor:** um teste sobe um daemon de verdade, entrega e usa segredos de teste (com quebra de linha, acento e `=`), e procura cada um, em texto, base64 e hex, nos logs, na saída do console e em todos os arquivos da pasta de dados, o banco incluído. O vermelho foi mostrado fazendo o `Vault` logar o valor. O `smoke:vault` faz a mesma procura nos logs do daemon, nos arquivos dele e na própria saída.
- **Ramos revelados pela cobertura (regra 7):** a ação que falha sem repassar a mensagem (vermelho: a mensagem com o valor).
- **`smoke:vault`:** foi escrito depois das áreas. O vermelho veio guardando o valor depois do uso: `SMOKE VAULT FAIL no passo "o valor sai da memória no uso"`, com exit 1.
- **Áreas do app que esperam a Fase 10:** `cofre-armazenamento`, `cofre-tipos`, `cofre-gerar-importar`, `cofre-uso`, `cofre-backup` e `cofre-ui`, e a lista de hosts permitidos de cada segredo (o app confere antes de entregar).

## Phase 16 decisions: the app side of delivery

- **The seam is `VaultPolicy`** (`apps/desktop/src/lib/vault-requests.ts`): `answerVaultRequest` guards the requester, asks the policy (`deny` with a reason, or `deliver`) and then applies the hard rules itself (the secret exists, the host is in its allowed hosts, the connection is loopback or Tailscale, the value is in the keyring). Phase 17 hands `AppStore` a `vaultPolicy` that asks the user; the default denies every request.
- **No `vault.deny` goes on the wire.** The daemon asks nobody in this phase, so a denial is only an outcome handed to `AppStore.onVaultOutcome` listeners (the usage log reads it). Phase 17 adds a deny command if the daemon waits for an answer.
- **Allowed hosts are compared with the host id.** The default `["local"]` therefore matches no host until the Hosts screen maps the machine's own host to it; until then a delivery is refused, which fails closed.
- **A `vault.request` that names `you` does not parse** (protocol), so the connection drops it before the policy; a requester that still reaches the app outside claude, automation and workflow is `unknown` and denied.

## Phase 16 decisions: the app screen, backup and shell

- **The usage log is app-side only** (`flightdeck.vault-usage` in `storage`, newest 500 lines). It records each outcome of a daemon `vault.request` (delivered or denied, with the reason) and each `vault.used` frame, tagged with the host that sent it. A use the app itself starts (`you`) is not logged yet: no such use exists until phase 15's Connect.
- **The `.fdvault` is `age`'s ASCII armor,** not the raw binary. The platform's `saveFile(name, text)` and `vault.pickFile()` both move text, and armor keeps them that way. The content is still encrypted with a passphrase (scrypt, work factor 18 by default; tests lower it through `AppStoreOptions.vaultWorkFactor`).
- **A wrong passphrase, a changed file and a file that is no backup all give `BackupError("unreadable")`.** `age` cannot tell them apart and telling them apart would help nobody.
- **A backup conflict is decided by secret id.** Same id with equal metadata and value is "same"; same id with anything different is "conflicting" and is kept or replaced as a whole, by one choice for the import. A secret that is in the backup under another id is "new" even if its name matches.
- **Reveal asks for a typed word, never the system's confirmation.** The spec prefers Windows Hello or the system password when available; the platform has no such call yet, so only the fallback exists. The word is `revelar` (pt-BR) or `reveal` (en); a secret's removal asks for its name.
- **A secret made on the screen gets the allowed hosts `["local"]`,** and **Editar** adds the real hosts by id (one checkbox per host). Hosts are compared by host id, so a new secret matches no host until it is edited. No daemon feature asks for secrets in this phase, so nothing is lost.
- **The Windows credential store holds 2560 bytes per entry.** `vault_set` refuses a larger value with a message. An `ed25519` key is under 500 bytes; a 4096-bit RSA key does not fit, and a backup restore of such a value would be refused the same way.
- **`tauri-plugin-dialog` is used from Rust only,** to open the key-file dialog, so no JS package and no capability is added. `Cargo.lock` was not regenerated (the Pi has no `cargo`); CI's `cargo check` updates it, and the next commit on a machine with cargo should keep it.
- **`vault_remove_file` deletes only the file `vault_pick_file` returned last,** and `vault_pick_file` forgets the previous pick first. The frontend therefore cannot delete an arbitrary path through the vault. The pick reads at most 1 MiB.
- **`vault_generate_key` runs on a worker thread** (`spawn_blocking`) so a slow or missing `ssh-keygen` does not freeze the window. The key is made in a temporary folder (mode 0700 on Unix) that is deleted on success and on error; the private key never stays on disk.
- **The version is 0.16.0 on this branch** (`test(versao)` cycle). Phases 14 and 15 bump nothing yet; at integration they come first and the version conflict resolves to the highest number.

## Phase 15 and 16 together

- **The ssh path enforces the same transport rule as `vault.deliver`.** `ssh.connect` and `ssh.test` with a `privateKey` from a connection outside loopback and Tailscale are refused in the daemon with the same reason as `vault.deliver` (`requireVaultTransport`), before anything is written or spawned, and the refusal is logged without the key (`ServerOptions.log`). A call without a key (agent or key file on the host) is not affected. The app also refuses to send a key to a host whose URL is not loopback or Tailscale (`checkDelivery`, code `transport`), so the daemon refusal is the second line.
- **An ssh destino uses the vault without `vault.deliver`.** `ssh.connect` and `ssh.test` already take the key as `privateKey` and hand it to the connection (agent or temporary file) themselves, so the app sends it there. The app obeys the same delivery rules first (`checkDelivery`: the secret exists, its allowed hosts include the host that runs ssh, the connection is loopback or Tailscale, the value is in the system vault) and logs the use as `ssh`, requester `you`, delivered or denied with the reason. The key is in no other command, in no state, no storage and no log.
- **The host that runs ssh is the one that must be allowed.** For a destino opened by another host, that is the via host's id; a secret made on the Cofre screen starts with `["local"]` and needs Editar to allow a host.
- **A destino's `secretRef` is the vault secret's id** for `vault-key` and for `password` (the latter optional: without it the app asks). `ssh`'s prompt is answered from the vault only when the reference is a secret of the vault that passes the same rules; otherwise the dialog opens.
- **Askpass answers are logged as uses** too, so the Uso tab shows each password ssh was given.

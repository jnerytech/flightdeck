# Flightdeck — Spec da Fase 9 (Distribuição e atualização automática)

## Objetivo e escopo

Desde a Fase 7 existem releases públicas no GitHub, com instalador do app e binários do daemon. Até aqui, atualizar ainda é manual: baixar, conferir e rodar `flightdeckd update` em cada host.

A Fase 9 fecha esse ciclo:

- o **app se atualiza sozinho** pela página de Releases;
- o **daemon de cada host é atualizado pelo app com um clique**;
- tudo **assinado**: o app e o daemon só aceitam o que a chave do projeto assinou.

Pré-requisito: Fase 8 fechada (tag `fase-8`). A fase é uma trilha só. A parte de chaves e segredos fica com o orquestrador.

**Dentro da Fase 9**

- Chave de assinatura do projeto, com a chave pública embutida no app e no daemon.
- Release assinada: instalador com `.sig`, daemons com `.sig`, manifestos `latest.json` (app) e `daemon-latest.json` (daemon).
- Atualizador do app (plugin updater do Tauri 2).
- Atualização do daemon pelo app: verificar, baixar, conferir a assinatura e aplicar pelo `flightdeckd update` da Fase 7.

**Fora da Fase 9**

- Assinatura de código do Windows (Authenticode). O SmartScreen continua avisando no primeiro download manual.
- Atualizar sem clique: o app só avisa, e quem instala é você.
- Canais (beta ou estável) e rollback para versões antigas pelo app. A volta automática da Fase 7 continua valendo quando a versão nova não sobe.

## Chave de assinatura (orquestrador)

- O orquestrador gera o par com `tauri signer generate`, com senha.
- **Chave privada:**
  - fica fora do repositório, em `~/.flightdeck-release/flightdeck.key`, com cópia de segurança indicada ao usuário;
  - vai para os segredos do repositório: `TAURI_SIGNING_PRIVATE_KEY` e `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- **Chave pública:** entra no repositório em `release/flightdeck.pub`. É lida no build:
  - do app, em `plugins.updater.pubkey`;
  - do daemon, como constante gerada.
- O formato é o do minisign, que o `tauri signer` produz: assinatura Ed25519 sobre o arquivo, num texto em base64 com linhas de comentário.

## Release assinada

O `release.yml` da Fase 7 ganha:

1. **Instalador:** build do app com `bundle.createUpdaterArtifacts: true` e a chave no ambiente. O instalador NSIS sai com o `.sig` ao lado.
2. **Daemons:** `tauri signer sign` em cada binário (windows-x64, linux-x64, linux-arm64), que gera um `.sig` para cada um.
3. **`latest.json` do app**, no formato do updater do Tauri:
   ```json
   { "version": "0.9.0", "notes": "...", "pub_date": "...",
     "platforms": { "windows-x86_64": { "signature": "<conteúdo do .sig>",
                                        "url": "https://github.com/jnerytech/flightdeck/releases/download/v0.9.0/<instalador>" } } }
   ```
4. **`daemon-latest.json`:**
   ```json
   { "version": "0.9.0", "protocol": 1,
     "assets": { "windows-x64": { "url": "...", "sha256": "...", "signature": "..." },
                 "linux-x64": { ... }, "linux-arm64": { ... } } }
   ```
5. O `SHA256SUMS` cobre todos os arquivos, inclusive os `.sig` e os manifestos.

- **Lógica:** fica nos scripts testáveis da Fase 7 (`scripts/lib/release.ts`), com testes. O YAML só os chama.
- **URL estável dos manifestos:** `https://github.com/jnerytech/flightdeck/releases/latest/download/<arquivo>`.

## Atualizador do app

- **Plugin:** `tauri-plugin-updater`, com o endpoint do `latest.json` e a chave pública.
- **Quando verifica:** ao abrir e a cada 6 h. Com versão nova, aparece uma faixa "Flightdeck X disponível" com notas, "Instalar e reiniciar" e "Depois".
- **Configurações:** "Procurar atualização agora" e "Avisar sobre atualizações", que vem ligado por padrão.
- **Assinatura inválida ou download quebrado:** mostra o erro e não instala nada.
- **Testes:** o updater fica atrás da interface de plataforma do app (`platform/`), como as notificações, e os testes usam um falso. O `cargo check` cobre a casca.

## Atualização do daemon pelo app

- **Config:**
  ```json
  { "updates": { "manifestUrl": "https://github.com/jnerytech/flightdeck/releases/latest/download/daemon-latest.json",
                 "checkIntervalH": 24 } }
  ```
- **Verificar:** o daemon baixa o manifesto ao subir e a cada `checkIntervalH`, e compara com a própria versão. O resultado aparece no `host.info` como `update: {available, version, checkedAt, error?}`.
- **Aplicar:** comando `daemon.update.apply`, só com `confirm: true`.
  1. Escolhe o asset do próprio sistema e arquitetura.
  2. Baixa para `<dataDir>/updates/` e confere o sha256 e a assinatura com a chave pública embutida. Ed25519 do minisign, verificado com `node:crypto`. Qualquer divergência apaga o arquivo e devolve `update_verification_failed`.
  3. Recusa com `update_needs_service` se o daemon não roda como serviço. O app mostra então o comando manual.
  4. Dispara o `flightdeckd update --from <arquivo baixado>` da Fase 7 **fora da árvore de processos do serviço**, para sobreviver à parada do daemon:
     - no Windows, uma tarefa agendada de execução única (`Flightdeck\update`), que se apaga ao fim;
     - no Linux, `systemd-run --user --collect`.
  5. Responde `{started: true}`. O app acompanha pela reconexão e pelo novo `daemonVersion` do `host.info`.
- **WSL supervisionado:** o daemon do WSL se atualiza com o asset linux-x64, pelo próprio comando.
- **Compatibilidade:** se o manifesto anuncia um `protocol` fora do intervalo do app, o app avisa para atualizar primeiro o app.
- **Rede:** `fetch` injetado.
  - Nos testes, um servidor local serve manifesto e binários assinados com uma **chave de teste**, que fica em `apps/daemon/test/fixtures/release/`.
  - A trava nova reprova qualquer acesso ao `github.com` durante a suíte.

## App: hosts

- **Tela de hosts:** cada host mostra a versão do daemon. Com atualização disponível, aparece "Atualizar daemon para X", que pede confirmação.
- **Durante a atualização:** o host mostra "atualizando…" até reconectar na versão nova. Se não reconectar em 2 minutos, mostra a falha e o comando manual.
- **Ordem sugerida:** quando app e daemons estão desatualizados, a faixa sugere atualizar primeiro o app e depois os daemons.

## Disciplina TDD

Segue [`docs/TDD.md`](TDD.md). Auditoria: `bun run tdd:audit -- --since fase-8`.

**Travas desta fase**

- Rede: nenhum teste acessa a internet. O preload reprova `fetch` para hosts que não sejam `127.0.0.1` ou `localhost`.
- Tarefas e unidades: a tarefa de execução única e o `systemd-run` passam pelo mesmo controlador de serviço injetado da Fase 7, e a trava de serviço reprova o uso real.
- Chave: a chave de teste é só de teste, e o teste confere que ela **não** é a chave pública do produto.

## Testes e critérios

**Áreas de teste**

| Área | O que precisa passar |
| --- | --- |
| `release-assinada` | `latest.json` e `daemon-latest.json` gerados com URLs, sha256 e assinaturas certas; SHA256SUMS cobre tudo; falta de `.sig` ou versão divergente param a release |
| `assinatura` | verificação minisign Ed25519 aceita o arquivo assinado pela chave de teste; recusa arquivo alterado, assinatura de outra chave e formato inválido |
| `daemon-update-check` | manifesto baixado no boot e no intervalo (relógio injetado); `host.info.update` com disponível, versão e erro; manifesto inválido vira erro sem derrubar o daemon |
| `daemon-update-apply` | escolhe o asset certo por sistema e arquitetura; confere sha256 e assinatura; recusa sem `confirm`, sem serviço e com verificação falha (apagando o arquivo); dispara o update fora do serviço (tarefa única ou `systemd-run`) com o caminho certo |
| `app-updater` | faixa com versão e notas; instalar chama o updater; erro de assinatura mostrado sem instalar; "Procurar agora" e desligar o aviso |
| `hosts-update-ui` | botão por host com confirmação; "atualizando…" até a versão nova; falha em 2 minutos com o comando manual; sugestão de ordem app → daemons |

**Smoke (`bun run smoke:update`)**

- Começa vermelho e roda com as travas ativas.
- Sobe um servidor local com um `daemon-latest.json` e binários falsos assinados pela chave de teste.
- Sobe um daemon `--runtime fake` apontando `updates.manifestUrl` para esse servidor, e confere `host.info.update.available` com a versão do manifesto.
- Faz `daemon.update.apply` num daemon sem serviço e recebe `update_needs_service`.
- Troca um byte do binário servido e recebe `update_verification_failed`, sem nenhum arquivo deixado em `updates/`.
- Imprime `SMOKE UPDATE OK`.

**Critérios de aceite**

- [ ] Para cada área, a conversa mostra o teste falhando por asserção antes da implementação e passando depois.
- [ ] `bun run tdd:audit -- --since fase-8` imprime `TDD AUDIT OK`.
- [ ] typecheck, lint e test saem com código 0, com cobertura de 100%.
- [ ] Todos os smokes passam, inclusive o `smoke:update`.
- [ ] `build:daemon`, `build:desktop` e `cargo check` saem com código 0.
- [ ] A CI do GitHub fica verde nas duas pernas.
- [ ] As versões vão a `0.9.0`.
- [ ] O README cobre a atualização do app, a do daemon pelo app e o que fazer quando ela falha.
- [ ] Divergências em `docs/DECISIONS.md` e `git status` limpo.
- [ ] O orquestrador fecha a fase:
  1. cria a tag `fase-9`;
  2. publica a `v0.9.0` pela pipeline;
  3. confere, na máquina do usuário, o ciclo real: app 0.9.0 instalado, release 0.9.1 de teste, atualização do app e do daemon pelo app.

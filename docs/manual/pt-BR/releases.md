# Releases

[Voltar ao manual](../pt-BR.md) · [English](../en/releases.md)

- **Integração contínua** ([`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml)): todo
  push no `main` e todo pull request rodam, no Ubuntu e no Windows:
  - typecheck, lint e os testes com cobertura de 100%;
  - todos os smokes (`smoke`, `smoke:multi`, `smoke:history`, `smoke:board`, `smoke:central`,
    `smoke:workflow`, `smoke:ops`, `smoke:limits`, `smoke:update` e `smoke:costs`);
  - no Windows, também o `cargo check` do app.

  Um job à parte, `screenshots`, roda `demo:shots` e `e2e` no Ubuntu e publica os prints.
- **Versão:** `packages/protocol`, `apps/daemon` e `apps/desktop` sobem juntos, e o
  `tauri.conf.json` lê a versão do desktop. Um teste falha se as versões divergirem.
- **Publicar:** só o orquestrador empurra a tag `v<versão>`, depois que a versão está no `main`.
  O [`.github/workflows/release.yml`](../../../.github/workflows/release.yml) roda no Windows:
  1. `bun run release:version <tag>`, que recusa uma tag que não bate com a versão do produto;
  2. `bun run release:tauri-config`, que monta a config de build do app com a chave pública e o
     endpoint do updater, e falha se `release/flightdeck.pub` não for uma chave pública válida;
  3. `bun run build:daemon`, que gera os três daemons;
  4. `bun run release:sign`, que assina os daemons;
  5. `bun run tauri build --bundles nsis,msi` em `apps/desktop`, que gera os instaladores (com a
     assinatura `.sig` do updater);
  6. `bun run release:assets`, que junta os arquivos, as assinaturas e os manifestos
     (`latest.json`, `daemon-latest.json`) em `release-assets/` com o `SHA256SUMS`;
  7. `gh release create <tag> --generate-notes`, com esses arquivos.
- **Repetir uma publicação:** pelo `workflow_dispatch`, informando a tag, que já precisa existir.
- **Ambiente:** o job usa o `GITHUB_TOKEN`, com `contents: write`, e os segredos
  `TAURI_SIGNING_PRIVATE_KEY` e `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, só para assinar as
  atualizações (minisign). Os instaladores do Windows saem sem assinatura Authenticode.

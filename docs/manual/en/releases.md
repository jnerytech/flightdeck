# Releases

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/releases.md)

- **Continuous integration** ([`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml)):
  every push to `main` and every pull request run, on Ubuntu and Windows:
  - typecheck, lint and the tests with 100% coverage;
  - all the smokes (`smoke`, `smoke:multi`, `smoke:history`, `smoke:board`, `smoke:central`,
    `smoke:workflow`, `smoke:ops`, `smoke:limits`, `smoke:update` and `smoke:costs`);
  - on Windows, also the app's `cargo check`.

  A separate job, `screenshots`, runs `demo:shots` and `e2e` on Ubuntu and publishes the
  screenshots.
- **Version:** `packages/protocol`, `apps/daemon` and `apps/desktop` are bumped together, and
  `tauri.conf.json` reads the desktop's version. A test fails if the versions diverge.
- **Publishing:** only the orchestrator pushes the `v<version>` tag, after the version is on
  `main`. [`.github/workflows/release.yml`](../../../.github/workflows/release.yml) runs on Windows:
  1. `bun run release:version <tag>`, which refuses a tag that does not match the product
     version;
  2. `bun run release:tauri-config`, which builds the app's build config with the public key and
     the updater endpoint, and fails if `release/flightdeck.pub` is not a valid public key;
  3. `bun run build:daemon`, which produces the three daemons;
  4. `bun run release:sign`, which signs the daemons;
  5. `bun run tauri build --bundles nsis,msi` in `apps/desktop`, which produces the installers
     (with the updater's `.sig` signature);
  6. `bun run release:assets`, which gathers the files, the signatures and the manifests
     (`latest.json`, `daemon-latest.json`) in `release-assets/` with the `SHA256SUMS`;
  7. `gh release create <tag> --generate-notes`, with those files.
- **Re-running a publication:** through `workflow_dispatch`, passing the tag, which must already
  exist.
- **Environment:** the job uses the `GITHUB_TOKEN`, with `contents: write`, and the secrets
  `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, only to sign the updates
  (minisign). The Windows installers ship without an Authenticode signature.

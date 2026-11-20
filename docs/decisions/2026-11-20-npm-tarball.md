# The CLI as an npm tarball on the GitHub release (issue #3541)

Part of #3423 (CLI first). Assigned by the coordinator, 2026-11-20.

## Context

A person with Node can already run `flightdeckd` from the release binaries, but must pick the
right file, `chmod +x` it and put it on the PATH. The goal is one command that does all three:
`npm i -g https://github.com/jnerytech/flightdeck/releases/download/v<version>/flightdeckd-<version>.tgz`.
Nothing goes to the npm registry, nothing downloads at install time, and no script runs at install.

## Decision

- `release/npm/` (outside the workspaces) holds the package: `package.json` (`private`, no scripts,
  no dependencies, a `files` whitelist), a plain-Node `launcher.js` and two entry files,
  `fd.js` and `flightdeckd.js`. The tarball carries all three daemons (linux-x64, linux-arm64,
  windows-x64); the launcher picks one by `process.platform` and `process.arch` from a fixed table.
- `bun run release:npm` stages the folder (`stageNpmPackage` in `scripts/lib/release/npm-package.ts`)
  and runs `npm pack`. The tarball is `dist/flightdeckd-<version>.tgz`, listed in `SHA256SUMS`, with
  no signature of its own: the daemons inside are the signed bytes.
- The package version is one more package that carries the product version (`PACKAGES` in
  `scripts/lib/release`), so the release bump and `tagProblems` cover it.

### Entry files

`fd` and `flightdeckd` are two files, each calling `main("<name>")`, instead of one reading
`process.argv[1]`: npm's Windows shims run `node <file>`, so `argv[1]` cannot tell the two names
apart. `fd` passes the binary `["fd", ...args]`, because the binary reads a leading `fd` as its alias
(`fd <subcommand>` is `flightdeckd <subcommand>`).

### Modes

Measured on the Pi (npm 10.9.8, node 22.22.3): a 0755 source file keeps 0755 through `npm pack` and
`npm i -g --prefix`; a 0644 source stays 0644 (npm only changes the mode of the bin targets). An
artifact download drops the execute bit, so `stageNpmPackage` sets 0755 explicitly on the binaries and
the entry files. The launcher never chmods. The tarball size is printed by the release job's smoke step
(`ls -l`); it is not measurable here without the real binaries.

### Signals

The launcher spawns the binary with inherited stdio and no shell. SIGINT is a no-op in the
launcher (the terminal already signals the binary's process group); SIGTERM is passed on with
`child.kill("SIGTERM")`. Ignoring both, as first drafted, would leave a launcher a plain `kill`
could not end. The exit code is the binary's, or 128 plus the signal number.

### Workflow layout

The release job ran on `windows-latest`, and `npm pack` there would not keep the execute bit of the
Linux binaries. A new `daemons` job on `ubuntu-latest` (read-only `contents`) installs, checks the tag,
runs `build:daemon`, signs (only that step holds the signing key), runs `release:npm`, installs the
tarball into a temporary prefix and runs `flightdeckd --version` and `fd --version` from it, then
uploads `dist/`. The Windows `release` job `needs: daemons` and downloads that artifact instead of
building and signing again. Reasons: the tarball carries the same signed bytes as the assets, and a
tarball failure stops the release before anything is public. Artifact actions are pinned by commit.

## Discarded

- Publishing to the registry or a scoped name, `npx`: out of scope, and a publish needs a token.
- A `postinstall` that downloads or chmods: runs code on the person's machine at install.
- One entry file reading `argv[1]`: wrong on Windows shims.
- Packing on `windows-latest`: loses the mode.
- Building twice (Windows and Linux jobs): two sets of bytes for one version.

## Consequences

- `flightdeckd update` replaces the service's copy in `~/.flightdeck/bin`, not npm's; updating
  npm's copy is a new `npm i -g` of the new tarball.
- The release now has a job before it; a failure in `daemons` blocks the whole release.
- The tarball is not signed: a person verifies it with `SHA256SUMS`.

## Open questions

- Is a self-update of the npm copy wanted (out of scope here)?
- Does the artifact hand-off from `daemons` to `release` keep file names under 0755 loss? The release
  job only copies, so it does not need the bit.

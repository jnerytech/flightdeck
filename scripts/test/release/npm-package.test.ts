import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { BINARIES } from "../../../release/npm/launcher.js";
import {
  DAEMONS,
  NPM_DIR,
  npmManifestProblems,
  npmTarball,
  readProductVersions,
  stageNpmPackage,
  tagProblems,
} from "../../lib/release/index.ts";
import { realTempDir } from "../temp-dir.ts";

/**
 * Issue #3541: `npm i -g <release tarball>` puts `fd` and `flightdeckd` on the PATH with no download
 * at install time. The package is the launcher plus the binaries `build:daemon` made, with no
 * lifecycle script and no dependency, and it never goes to the npm registry.
 */
const ROOT = resolve(import.meta.dir, "../../..");
const VERSION = "0.7.0";
const manifest = () =>
  JSON.parse(readFileSync(join(ROOT, NPM_DIR, "package.json"), "utf8")) as Record<string, unknown>;
const GOOD: Record<string, unknown> = { ...manifest(), version: VERSION };

/** A checkout after `build:daemon`: the three binaries in `dist/`, written 0644 the way an artifact download leaves them. */
function built() {
  const root = realTempDir("fd-npm-");
  for (const path of DAEMONS) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(
      join(root, path),
      `#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)))\n`,
    );
    chmodSync(join(root, path), 0o644);
  }
  mkdirSync(join(root, NPM_DIR), { recursive: true });
  for (const file of readdirSync(join(ROOT, NPM_DIR))) {
    writeFileSync(join(root, NPM_DIR, file), readFileSync(join(ROOT, NPM_DIR, file)));
  }
  writeFileSync(join(root, NPM_DIR, "package.json"), JSON.stringify(GOOD, null, 2));
  return root;
}

describe("npm package: its shape (#3541)", () => {
  test("the package in release/npm is `flightdeckd` with a `fd` and a `flightdeckd` command", () => {
    const m = manifest();
    expect([m.name, m.bin, m.private]).toEqual([
      "flightdeckd",
      { fd: "fd.js", flightdeckd: "flightdeckd.js" },
      true,
    ]);
  });

  test("a manifest of this release has no problem, and the tarball is flightdeckd-<version>.tgz in dist/", () => {
    expect([npmManifestProblems(GOOD, VERSION), npmTarball(VERSION)]).toEqual([
      [],
      "dist/flightdeckd-0.7.0.tgz",
    ]);
  });

  test("a lifecycle script, a dependency, another version, a missing command or a stray file is named", () => {
    const problems = (patch: Record<string, unknown>) =>
      npmManifestProblems({ ...GOOD, ...patch }, VERSION);
    expect([
      problems({ scripts: { postinstall: "curl x | sh" } }),
      problems({ dependencies: { left: "1.0.0" } }),
      problems({ version: "0.6.0" }),
      problems({ bin: { flightdeckd: "flightdeckd.js" } }),
      problems({ files: [...(GOOD.files as string[]), "extra.js"] }),
      problems({ private: false }),
    ]).toEqual([
      ["release/npm/package.json declares scripts: an install must run nothing"],
      ["release/npm/package.json declares dependencies: the tarball has none"],
      ["release/npm/package.json is at 0.6.0, the release is 0.7.0"],
      ["release/npm/package.json bin must be fd and flightdeckd"],
      ["release/npm/package.json files must be the launcher and the three binaries"],
      ["release/npm/package.json must stay private: nothing goes to the registry"],
    ]);
  });

  test("the launcher's table names exactly the binaries build:daemon makes", () => {
    expect(Object.values(BINARIES).sort()).toEqual(
      DAEMONS.map((path) => path.replace("dist/", "")).sort(),
    );
  });
});

describe("npm package: the product version covers it (#3541)", () => {
  test("release:version reads the package and a tag that is not its version names it", () => {
    const versions = readProductVersions(ROOT);
    expect(Object.keys(versions)).toEqual([
      "packages/protocol",
      "apps/daemon",
      "apps/desktop",
      "release/npm",
    ]);
    expect(tagProblems("v0.8.0", { ...versions, "release/npm": "0.7.0" })).toContain(
      "release/npm está em 0.7.0, a tag pede 0.8.0",
    );
  });
});

describe("npm package: the folder that is packed (#3541)", () => {
  test("it holds the launcher, the two entries, the manifest and the three binaries, nothing else", () => {
    const root = built();
    const out = join(realTempDir("fd-npm-out-"), "pkg");
    const staged = stageNpmPackage(root, out, VERSION);
    const expected = [
      "fd.js",
      "flightdeckd-linux-arm64",
      "flightdeckd-linux-x64",
      "flightdeckd-windows-x64.exe",
      "flightdeckd.js",
      "launcher.js",
      "package.json",
    ];
    expect([staged, readdirSync(out).sort()]).toEqual([expected, expected]);
  });

  test.skipIf(process.platform === "win32")(
    // Windows has no execute bit to read back; the Linux job packs, so the bit is set where it counts.
    "the binaries and the entries are executable in it even when they came in as plain files",
    () => {
      const out = join(realTempDir("fd-npm-out-"), "pkg");
      stageNpmPackage(built(), out, VERSION);
      const mode = (file: string) => (statSync(join(out, file)).mode & 0o777).toString(8);
      expect(
        [
          "fd.js",
          "flightdeckd.js",
          "flightdeckd-linux-x64",
          "flightdeckd-linux-arm64",
          "flightdeckd-windows-x64.exe",
        ].map(mode),
      ).toEqual(["755", "755", "755", "755", "755"]);
    },
  );

  test("a missing binary or a manifest of another version stops the pack before anything is written", () => {
    const fail = (root: string, version = VERSION) => {
      const out = join(realTempDir("fd-npm-out-"), "never");
      try {
        stageNpmPackage(root, out, version);
        return "staged";
      } catch (error) {
        return `${(error as Error).message} | written: ${readdirSync(dirname(out)).length}`;
      }
    };
    expect(fail(built(), "0.8.0")).toContain(
      "release/npm/package.json is at 0.7.0, the release is 0.8.0",
    );
    const missing = built();
    Bun.spawnSync(["rm", "-f", join(missing, "dist/flightdeckd-linux-arm64")]);
    expect(fail(missing)).toBe("faltam arquivos: dist/flightdeckd-linux-arm64 | written: 0");
  });
});

/**
 * The real npm, into a temporary prefix: what `npm i -g <file>` does to the tarball. Linux only,
 * where the launcher's three binaries include the one of this machine's family; skipped without npm.
 */
const npm = Bun.which("npm", { PATH: process.env.PATH ?? "" });
describe("npm package: a real `npm i -g` of the tarball (#3541)", () => {
  test.skipIf(process.platform !== "linux" || npm === null)(
    "it puts fd and flightdeckd on the prefix's PATH, each runs the binary of this machine, and no script runs",
    async () => {
      const out = join(realTempDir("fd-npm-out-"), "pkg");
      const root = built();
      stageNpmPackage(root, out, VERSION);
      const scratch = realTempDir("fd-npm-prefix-");
      const env = { ...process.env, HOME: scratch, npm_config_userconfig: join(scratch, "npmrc") };
      const sh = (cmd: string[], cwd: string) =>
        Bun.spawnSync(cmd, { cwd, env, stdout: "pipe", stderr: "pipe" });
      const packed = sh([npm as string, "pack", "--pack-destination", scratch, "--silent"], out);
      const tgz = join(scratch, packed.stdout.toString().trim());
      const prefix = join(scratch, "prefix");
      const install = sh(
        [
          npm as string,
          "install",
          "-g",
          "--prefix",
          prefix,
          "--cache",
          join(scratch, "cache"),
          "--no-audit",
          "--no-fund",
          tgz,
        ],
        scratch,
      );
      const call = (bin: string, ...args: string[]) => {
        const command = join(prefix, "bin", bin);
        if (!existsSync(command)) return `${bin} is not on the prefix's PATH`;
        const run = Bun.spawnSync([command, ...args], { env, stdout: "pipe" });
        return run.stdout.toString().trim();
      };
      expect([install.exitCode, call("flightdeckd", "a b", "$(id)"), call("fd", "status")]).toEqual(
        [0, '["a b","$(id)"]', '["fd","status"]'],
      );
    },
  );
});

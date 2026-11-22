import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { SshImporter } from "../../../apps/daemon/src/ssh/import.ts";
import type { SshTargets } from "../../../apps/daemon/src/ssh/targets.ts";
import { writeDemoSshConfig } from "../../lib/demo/ssh-config.ts";
import { realTempDir } from "../temp-dir.ts";

/**
 * #3945: the e2e journey of Connections imports names from the host's `~/.ssh/config`. The demo's daemons
 * run as the machine's user, so without this file the import would read the runner's real config. The demo
 * points HOME at a temporary folder; this is what it puts there.
 */
const none = { list: () => [] } as unknown as SshTargets;

async function previewOf(home: string, path: string) {
  const importer = new SshImporter({ targets: none, configPath: path, home, defaultUser: "me" });
  return (await importer.preview()).entries;
}

describe("demo-ssh-config: the fake config the demo's import reads", () => {
  // Windows keeps no POSIX mode bits, so the owner-only check has no meaning there.
  test.skipIf(process.platform === "win32")(
    "the file is written inside the home it is given, and only the owner can read it",
    () => {
      const home = realTempDir("fd-ssh-config-");
      const path = writeDemoSshConfig(home);
      expect([path, existsSync(path), existsSync(path) ? statSync(path).mode & 0o077 : -1]).toEqual(
        [join(home, ".ssh", "config"), true, 0],
      );
    },
  );

  test("the import lists one name per language run, so the two runs never import the same one", async () => {
    const home = realTempDir("fd-ssh-config-");
    const entries = await previewOf(home, writeDemoSshConfig(home));
    expect(entries.map((e) => e.alias).sort()).toEqual(["lab-en", "lab-pt-br"]);
  });

  test("each name has its own host, so one import does not make the other 'already saved'", async () => {
    const home = realTempDir("fd-ssh-config-");
    const entries = await previewOf(home, writeDemoSshConfig(home));
    expect([entries.length, new Set(entries.map((e) => e.host)).size]).toEqual([2, 2]);
  });

  test("the names point only at documentation hosts, with a user and no key file", async () => {
    const home = realTempDir("fd-ssh-config-");
    const entries = await previewOf(home, writeDemoSshConfig(home));
    const rows = entries.map((e) => [
      /\.example\.test$/.test(e.host),
      e.user,
      e.identityFile,
      e.proxyJump,
    ]);
    expect(rows).toEqual([
      [true, "ops", null, null],
      [true, "ops", null, null],
    ]);
  });

  test("a second call leaves the same, non-empty file", () => {
    const home = realTempDir("fd-ssh-config-");
    const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : "");
    const first = read(writeDemoSshConfig(home));
    expect([first.length > 0, read(writeDemoSshConfig(home))]).toEqual([true, first]);
  });
});

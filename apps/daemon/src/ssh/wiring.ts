import type { Database } from "bun:sqlite";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import type { Config } from "../config.ts";
import { spawnExec } from "../exec.ts";
import { present } from "../present.ts";
import { whichOnPath } from "../which.ts";
import { AskpassBroker, askpassHook } from "./askpass.ts";
import {
  processExec,
  processRun,
  resolveSshPath,
  SshConnector,
  type SshConnectorOptions,
} from "./connect.ts";
import { HostKeys } from "./hostkey.ts";
import { SshImporter } from "./import.ts";
import { chooseDelivery, processOps } from "./key-delivery.ts";
import { SshTargets } from "./targets.ts";

/** What the SSH side of the host is built from. */
export interface SshDeps {
  db: Database;
  config: Pick<Config, "dataDir" | "ssh">;
  configFile: string;
  /** This daemon's own command line: the askpass hook calls it back. */
  self: string[];
  terminals: SshConnectorOptions["terminals"];
  /** Whether a file is there, for finding the ssh executable. */
  exists: (path: string) => boolean | Promise<boolean>;
  /** The home the daemon runs with: its ~/.ssh/config is read for the import. */
  home: string;
}

/**
 * The SSH destinations of the host (phase 15, issue #1593): their targets and server keys, the
 * connector with its askpass and key delivery, the lookups the actions make by name, and what the
 * server offers of them.
 */
export async function createSsh({
  db,
  config,
  configFile,
  self,
  terminals,
  exists,
  home,
}: SshDeps) {
  const sshTargets = new SshTargets({ db });
  const sshHostKeys = new HostKeys({ targets: sshTargets });
  const sshDir = join(config.dataDir, "ssh");
  const askpass = new AskpassBroker({});
  const sshAskpass = await askpassHook({
    broker: askpass,
    dir: sshDir,
    platform: process.platform,
    self,
    configFile,
  });
  const sshConnect = new SshConnector({
    targets: sshTargets,
    hostKeys: sshHostKeys,
    terminals,
    dir: sshDir,
    sshPath:
      config.ssh.path ??
      (await resolveSshPath({ platform: process.platform, exists, which: whichOnPath })),
    run: processRun(),
    exec: processExec(),
    ...present({ askpass: sshAskpass }),
    // The Windows agent runs only as a service with a fixed pipe: there the key is a temp file.
    delivery: chooseDelivery({
      platform: process.platform,
      keysDir: join(sshDir, "keys"),
      sockDir: tmpdir(),
      user: userInfo().username,
      exec: spawnExec,
      ops: processOps(),
    }),
  });
  return {
    sshConnect,
    /** The tags of the one destination with that name; none when the name is not unique. */
    tagsOf: (name: string) => {
      const named = sshTargets.list().filter((t) => t.name === name);
      return named.length === 1 ? (named[0]?.tags ?? []) : [];
    },
    /** The vault secret of a vault-key destination with that name; null otherwise. */
    vaultKeyOf: (name: string) => {
      const named = sshTargets.list().filter((t) => t.name === name);
      return named.length === 1 && named[0]?.auth === "vault-key" ? named[0].secretRef : null;
    },
    server: {
      ssh: sshTargets,
      sshHostKeys,
      sshConnect,
      askpass,
      // Read-only: this host's own ~/.ssh/config, under whatever home the daemon runs with.
      sshImport: new SshImporter({
        targets: sshTargets,
        configPath: join(home, ".ssh", "config"),
        home,
        defaultUser: userInfo().username,
      }),
    },
  };
}

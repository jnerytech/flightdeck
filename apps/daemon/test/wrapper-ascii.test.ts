import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { ExternalSessions } from "../src/central/external.ts";
import { startReceptor } from "../src/central/receptor.ts";
import { PLAIN_PATH, RECEPTOR_FILE, TERMINAL_LAUNCH_VAR } from "../src/central/wrapper.ts";
import { runCli } from "../src/main.ts";
import { startServer } from "../src/server.ts";
import { EventStore } from "../src/store/event-store.ts";
import { installFakeClaude } from "./fake-claude.ts";
import { newManager, tempDir, workspace } from "./helpers.ts";

/** Issue #936: on Windows the channel config goes to a plain path claude can read back. */
const HOOKS = "hooks-token-0123456789";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

function receptor() {
  const external = new ExternalSessions({ db: new EventStore(":memory:").db, staleAfterS: 900 });
  const server = startReceptor({ port: 0, token: () => HOOKS, external, isManaged: () => false });
  cleanups.push(() => server.stop());
  return server.url;
}

/** A host whose data folder is `dataParts` below a temp folder, claude as given. */
function host(dataParts: string[], executablePath?: string) {
  const dir = tempDir();
  const dataDir = join(dir, ...dataParts);
  mkdirSync(dataDir, { recursive: true });
  const file = join(dir, "config.json");
  writeFileSync(
    file,
    JSON.stringify({
      token: "t".repeat(32),
      dataDir,
      hooks: { port: 0, token: HOOKS },
      ...(executablePath ? { claude: { executablePath } } : {}),
    }),
  );
  writeFileSync(join(dataDir, RECEPTOR_FILE), JSON.stringify({ url: receptor() }));
  return { file, dataDir };
}

interface Acl {
  cmd: string[];
  /** What the folder held when icacls ran: the token file must not be there yet. */
  listing: string[];
}

async function launch(
  file: string,
  options: {
    platform?: NodeJS.Platform;
    env?: Record<string, string>;
    aclCode?: number;
    /** `icacls` cannot run (it is missing, or the process cannot start). */
    aclThrows?: boolean;
    /** Something done to the folder right after icacls, as a hostile or broken disk would. */
    afterAcl?: (folder: string) => void;
    /** A fake claude already installed (its shim is what the config names). */
    fake?: ReturnType<typeof installFakeClaude>;
    /** The folder claude runs in (a project the host allows). */
    cwd?: string;
    /** The wrapper may reject (an early failure): `launch` then still answers. */
    mayReject?: boolean;
  } = {},
) {
  const acls: Acl[] = [];
  const errors: string[] = [];
  const fake = options.fake ?? installFakeClaude([{ do: "exit", code: 0 }]);
  cleanups.push(fake.restore);
  const run = runCli(["claude", "-c"], {
    env: { ...process.env, FLIGHTDECK_CONFIG: file, ...options.env },
    log: { log: () => {}, error: (m) => errors.push(m) },
    exit: () => {},
    onSignal: () => {},
    selfCommand: ["C:\\fd\\flightdeckd.exe"],
    ...(options.platform ? { platform: options.platform } : {}),
    ...(options.cwd ? { cwd: options.cwd } : {}),
    exec: async (cmd) => {
      if (options.aclThrows) throw new Error("icacls is not here");
      acls.push({ cmd, listing: readdirSync(cmd[1] ?? "") });
      options.afterAcl?.(cmd[1] ?? "");
      return { code: options.aclCode ?? 0, stdout: "" };
    },
  });
  const [settled] = await Promise.allSettled([run]);
  if (settled?.status === "rejected" && !options.mayReject) throw settled.reason;
  const found = fake.events().find((e) => e.type === "start") as unknown as
    | {
        args: string[];
        mcpConfig: { mcpServers: Record<string, unknown> } | null;
      }
    | undefined;
  const start = found ?? { args: [], mcpConfig: null };
  const at = start.args.indexOf("--mcp-config");
  return { start, acls, errors, configPath: at < 0 ? null : (start.args[at + 1] ?? null), fake };
}

/** The launch id in a folder's name: `Flightdeck-<id>`. */
const launchIdOf = (folder: string) => folder.slice(folder.lastIndexOf("Flightdeck-") + 11);

const WINDOWS_ENV = (programData: string, over: Record<string, string> = {}) => ({
  ProgramData: programData,
  SystemRoot: "C:\\Windows",
  USERNAME: "joão",
  USERDOMAIN: "PC",
  ...over,
});

describe("wrapper-ascii: the channel config is read back from a plain path (#936)", () => {
  test("the plain-path rule: letters, digits and \\ / : . _ - only", () => {
    const plain = ["C:\\ProgramData\\Flightdeck-01ABC\\01ABC.json", "/tmp/fd-1/a_b.json"];
    const not = [
      "C:\\Users\\João Silva\\AppData\\x.json",
      "C:\\Users\\Ana Lima\\x.json",
      "C:\\a&b\\x.json",
      "C:\\a%TEMP%\\x.json",
      "C:\\a^b\\x.json",
      "C:\\a(b)\\x.json",
    ];
    expect([plain.map((p) => PLAIN_PATH.test(p)), not.map((p) => PLAIN_PATH.test(p))]).toEqual([
      plain.map(() => true),
      not.map(() => false),
    ]);
  });

  test("a data folder with a space and an accent: the config goes to a private plain folder, and is gone after", async () => {
    const programData = tempDir();
    const { file } = host(["João Silva", "data"]);
    const run = await launch(file, { platform: "win32", env: WINDOWS_ENV(programData) });
    const path = run.configPath ?? "";
    expect([
      PLAIN_PATH.test(path),
      path.startsWith(programData),
      Object.keys(run.start.mcpConfig?.mcpServers ?? {}),
      existsSync(path),
      readdirSync(programData),
    ]).toEqual([true, true, ["flightdeck"], false, []]);
    // The folder is restricted to the user before the file with the token is written into it.
    expect(run.acls).toHaveLength(1);
    expect(run.acls[0]?.cmd.slice(0, 1)).toEqual(["C:\\Windows\\System32\\icacls.exe"]);
    expect(run.acls[0]?.cmd.slice(2)).toEqual(["/inheritance:r", "/grant:r", "PC\\joão:(OI)(CI)F"]);
    expect(run.acls[0]?.listing).toEqual([]);
  });

  test("claude as a .cmd shim, with a path cmd.exe would change (& or %): the same plain folder", async () => {
    const programData = tempDir();
    const fake = installFakeClaude([{ do: "exit", code: 0 }]);
    const shim = join(fake.dir, "claude.cmd");
    copyFileSync(join(fake.dir, "claude"), shim);
    chmodSync(shim, 0o755);
    fake.restore();
    const { file } = host(["a&b%TEMP%", "data"], shim);
    const run = await launch(file, { platform: "win32", env: WINDOWS_ENV(programData), fake });
    expect([
      PLAIN_PATH.test(run.configPath ?? ""),
      (run.configPath ?? "").startsWith(programData),
      run.acls.length,
    ]).toEqual([true, true, 1]);
  });

  test("a data folder that is already plain keeps the config where it was, with no folder made and no icacls", async () => {
    const programData = tempDir();
    const { file, dataDir } = host(["data"]);
    const run = await launch(file, { platform: "win32", env: WINDOWS_ENV(programData) });
    expect([
      (run.configPath ?? "").startsWith(join(dataDir, "channels")),
      run.acls.length,
      readdirSync(programData),
    ]).toEqual([true, 0, []]);
  });

  test("on Linux an accent and a space change nothing: the config stays in the data folder", async () => {
    const { file, dataDir } = host(["João Silva", "data"]);
    const run = await launch(file, { env: WINDOWS_ENV(tempDir()) });
    expect([(run.configPath ?? "").startsWith(join(dataDir, "channels")), run.acls.length]).toEqual(
      [true, 0],
    );
  });

  test("a ProgramData that is not plain is passed over for the public folder", async () => {
    const odd = join(tempDir(), "Program Data");
    mkdirSync(odd);
    const publicFolder = tempDir();
    const { file } = host(["João Silva", "data"]);
    const run = await launch(file, {
      platform: "win32",
      env: WINDOWS_ENV(odd, { PUBLIC: publicFolder }),
    });
    expect([(run.configPath ?? "").startsWith(publicFolder), readdirSync(odd)]).toEqual([true, []]);
  });

  test("when the folder cannot be restricted, the config is not written and claude opens with neither flag", async () => {
    const programData = tempDir();
    const { file } = host(["João Silva", "data"]);
    const run = await launch(file, {
      platform: "win32",
      env: WINDOWS_ENV(programData),
      aclCode: 5,
    });
    expect([
      run.configPath,
      run.start.args.includes("--dangerously-load-development-channels"),
      readdirSync(programData),
      run.errors.join("\n").includes("configuração do canal"),
    ]).toEqual([null, false, [], true]);
  });

  test("with no plain folder to use, or no user to give it to, claude opens with neither flag", async () => {
    const { file } = host(["João Silva", "data"]);
    const noBase = await launch(file, { platform: "win32", env: { USERNAME: "joão" } });
    const noUser = await launch(file, {
      platform: "win32",
      env: { ProgramData: tempDir(), USERNAME: "" },
    });
    expect([noBase.configPath, noUser.configPath, noBase.acls.length, noUser.acls.length]).toEqual([
      null,
      null,
      0,
      0,
    ]);
    expect(noBase.errors.join("\n")).toContain("configuração do canal");
  });

  test("a ProgramData that is not there, or an icacls that cannot run, is no folder: claude opens with neither flag", async () => {
    const { file } = host(["João Silva", "data"]);
    const missing = await launch(file, {
      platform: "win32",
      env: WINDOWS_ENV(join(tempDir(), "missing")),
    });
    const noIcacls = await launch(file, {
      platform: "win32",
      env: WINDOWS_ENV(tempDir()),
      aclThrows: true,
    });
    expect([missing.configPath, noIcacls.configPath, missing.acls.length]).toEqual([null, null, 0]);
  });

  test("a config that cannot be written into the plain folder leaves nothing behind", async () => {
    const programData = tempDir();
    const { file } = host(["João Silva", "data"]);
    // The folder is made, restricted, and then the file cannot go in: a file stands in its place.
    const run = await launch(file, {
      platform: "win32",
      env: WINDOWS_ENV(programData),
      afterAcl: (folder) =>
        writeFileSync(join(folder, `${launchIdOf(folder)}.json`), "x", { mode: 0o400 }),
    });
    expect([run.configPath, readdirSync(programData)]).toEqual([null, []]);
  });

  test("a file planted in the new folder before it was restricted: the token is not written into it", async () => {
    const programData = tempDir();
    const { file } = host(["João Silva", "data"]);
    let planted = "";
    const run = await launch(file, {
      platform: "win32",
      env: WINDOWS_ENV(programData),
      // Another user made the config's own name first, with a mode that lets the write in.
      afterAcl: (folder) => {
        planted = join(folder, `${launchIdOf(folder)}.json`);
        writeFileSync(planted, "planted", { mode: 0o666 });
      },
    });
    expect([run.configPath, readFileSync(planted, "utf8")]).toEqual([null, "planted"]);
  });

  test("anything else found in the folder once it is restricted is refused too", async () => {
    const programData = tempDir();
    const { file } = host(["João Silva", "data"]);
    const run = await launch(file, {
      platform: "win32",
      env: WINDOWS_ENV(programData),
      afterAcl: (folder) => writeFileSync(join(folder, "other.txt"), "x"),
    });
    expect([
      run.configPath,
      run.start.args.includes("--dangerously-load-development-channels"),
    ]).toEqual([null, false]);
  });

  test("a folder that is already there is not ours: it is left as it is, and the next base is tried", async () => {
    const programData = tempDir();
    const publicFolder = tempDir();
    const id = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
    const theirs = join(programData, `Flightdeck-${id}`);
    mkdirSync(theirs);
    writeFileSync(join(theirs, "keep.txt"), "theirs");
    const { file } = host(["João Silva", "data"]);
    const run = await launch(file, {
      platform: "win32",
      env: WINDOWS_ENV(programData, { PUBLIC: publicFolder, [TERMINAL_LAUNCH_VAR]: id }),
    });
    expect([
      (run.configPath ?? "").startsWith(publicFolder),
      readdirSync(theirs),
      readFileSync(join(theirs, "keep.txt"), "utf8"),
    ]).toEqual([true, ["keep.txt"], "theirs"]);
  });

  test("a user name that could name another principal is not given the folder", async () => {
    const { file } = host(["João Silva", "data"]);
    const names = ["*S-1-1-0", "Everyone:(OI)(CI)F", "a/b", "a;b", "a,b", " "];
    const runs = await Promise.all(
      names.map((USERNAME) =>
        launch(file, { platform: "win32", env: WINDOWS_ENV(tempDir(), { USERNAME }) }),
      ),
    );
    expect([runs.map((r) => r.configPath), runs.map((r) => r.acls.length)]).toEqual([
      names.map(() => null),
      names.map(() => 0),
    ]);
    const domain = await launch(file, {
      platform: "win32",
      env: WINDOWS_ENV(tempDir(), { USERDOMAIN: "*S-1-1-0" }),
    });
    expect(domain.configPath).toBeNull();
  });

  test("a base that is not a local folder is passed over: a network share, a relative path, one that climbs", async () => {
    const { file } = host(["João Silva", "data"]);
    const publicFolder = tempDir();
    const bases = ["\\\\server\\share", "//server/share", "relative/dir", "C:rel", "/tmp/a/../b"];
    const runs = await Promise.all(
      bases.map((base) =>
        launch(file, {
          platform: "win32",
          env: WINDOWS_ENV(base, { PUBLIC: publicFolder }),
        }),
      ),
    );
    expect(runs.map((r) => (r.configPath ?? "").startsWith(publicFolder))).toEqual(
      bases.map(() => true),
    );
  });

  test("a failure after the config is written still removes it and its folder", async () => {
    const programData = tempDir();
    const { root, project } = workspace();
    const server = startServer({
      manager: newManager().manager,
      knowledgeFeed: async () => ({ text: "index", fed: 1, truncated: false }),
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: "t".repeat(32),
      allowedRoots: [root],
    });
    cleanups.push(() => server.stop());
    const { file, dataDir } = host(["João Silva", "data"]);
    writeFileSync(
      file,
      JSON.stringify({
        token: "t".repeat(32),
        port: server.port,
        dataDir,
        hooks: { port: 0, token: HOOKS },
      }),
    );
    // The index goes in a file under `personas`: a file stands there, so writing it fails.
    writeFileSync(join(dataDir, "personas"), "not a folder");
    const run = await launch(file, {
      platform: "win32",
      env: WINDOWS_ENV(programData),
      cwd: project,
      mayReject: true,
    });
    expect([run.start.args, readdirSync(programData)]).toEqual([[], []]);
  });
});

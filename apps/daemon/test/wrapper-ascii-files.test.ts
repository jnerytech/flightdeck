import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { KnowledgeIndexResult } from "@flightdeck/protocol";
import { ExternalSessions } from "../src/central/external.ts";
import { type Receptor, startReceptor } from "../src/central/receptor.ts";
import { PLAIN_PATH, RECEPTOR_FILE } from "../src/central/wrapper.ts";
import { runCli } from "../src/main.ts";
import { packPersonas } from "../src/personas/pack.ts";
import { Personas } from "../src/personas/store.ts";
import { startServer } from "../src/server.ts";
import { SecretScanner } from "../src/snippets/model.ts";
import { EventStore } from "../src/store/event-store.ts";
import { installFakeClaude } from "./fake-claude.ts";
import { newManager, tempDir, workspace } from "./helpers.ts";

/**
 * Issue #936: every file the wrapper hands to `claude` by path (the channel config, the persona and
 * index file, the subagents file) is read back from a plain path on Windows, from one private folder.
 */
setDefaultTimeout(40_000);

const TOKEN = "t".repeat(32);
const HOOKS = "hooks-token-0123456789";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const INDEX: KnowledgeIndexResult = {
  text: "Project documents.\n\n- docs/adr/0001-a.md: Use SQLite\n",
  fed: 1,
  truncated: false,
};

/** A daemon the terminal talks to, whose data folder is `dataParts` below a temp folder. */
async function terminalHost(dataParts: string[]) {
  const { root, project } = workspace();
  const dir = tempDir();
  const dataDir = join(dir, ...dataParts);
  mkdirSync(dataDir, { recursive: true });
  const external = new ExternalSessions({ db: new EventStore(":memory:").db, staleAfterS: 900 });
  const receptor: Receptor = startReceptor({
    port: 0,
    token: () => HOOKS,
    external,
    isManaged: () => false,
  });
  cleanups.push(() => receptor.stop());
  writeFileSync(join(dataDir, RECEPTOR_FILE), JSON.stringify({ url: receptor.url }));
  const personas = new Personas({
    db: new EventStore(":memory:").db,
    allowedRoots: [root],
    scanner: new SecretScanner(),
    pack: packPersonas,
  });
  const server = startServer({
    manager: newManager().manager,
    personas,
    knowledgeFeed: async () => INDEX,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [root],
  });
  cleanups.push(() => server.stop());
  const file = join(dir, "config.json");
  writeFileSync(
    file,
    JSON.stringify({ token: TOKEN, port: server.port, dataDir, hooks: { port: 0, token: HOOKS } }),
  );
  return { file, project, dataDir };
}

interface Started {
  args: string[];
  appended: string | null;
  agents: Record<string, unknown> | null;
  mcpConfig: unknown;
}

/** One launch as on Windows: icacls is the injected exec, and it notes what the folder held. */
async function launch(
  host: { file: string; project: string },
  args: string[],
  options: { programData: string; aclCode?: number },
) {
  const fake = installFakeClaude([{ do: "exit", code: 0 }]);
  cleanups.push(fake.restore);
  const acls: Array<{ folder: string; listing: string[] }> = [];
  await runCli(["claude", ...args], {
    env: {
      ...process.env,
      FLIGHTDECK_CONFIG: host.file,
      ProgramData: options.programData,
      SystemRoot: "C:\\Windows",
      USERNAME: "joão",
      USERDOMAIN: "PC",
    },
    log: { log: () => {}, error: () => {} },
    exit: () => {},
    onSignal: () => {},
    selfCommand: [process.execPath, "run", join(import.meta.dir, "..", "src", "bin.ts")],
    cwd: host.project,
    platform: "win32",
    exec: async (cmd) => {
      acls.push({ folder: cmd[1] ?? "", listing: readdirSync(cmd[1] ?? "") });
      return { code: options.aclCode ?? 0, stdout: "" };
    },
  });
  const start = fake.events().find((e) => e.type === "start") as unknown as Started;
  return { start, acls };
}

/** The value after `flag` in claude's arguments. */
const argAfter = (args: string[], flag: string) => args[args.indexOf(flag) + 1] ?? null;

/** The file argument of each flag claude is given, for the launch kinds that give it. */
const FILE_ARGS: Array<{ title: string; args: string[]; flag: string }> = [
  { title: "the channel config", args: ["-c"], flag: "--mcp-config" },
  {
    title: "the persona body and the index",
    args: ["--persona", "qa"],
    flag: "--append-system-prompt-file",
  },
  { title: "the index alone", args: ["-c"], flag: "--append-system-prompt-file" },
  { title: "the subagents of print mode", args: ["-p", "hi"], flag: "--agents" },
];

describe("wrapper-ascii-files: every file claude is given by path is plain on Windows (#936)", () => {
  for (const row of FILE_ARGS) {
    test(`${row.title} (${row.flag}): a data folder with a space and an accent puts it in a plain private folder, gone after`, async () => {
      const programData = tempDir();
      const host = await terminalHost(["João Silva", "data"]);
      const run = await launch(host, row.args, { programData });
      const path = argAfter(run.start.args, row.flag) ?? "";
      const used = readdirSync(programData);
      expect([
        path.length > 0,
        PLAIN_PATH.test(path),
        path.startsWith(programData),
        // restricted before anything went into it, one folder for the whole launch, taken away after
        run.acls.length,
        run.acls[0]?.listing,
        used,
      ]).toEqual([true, true, true, 1, [], []]);
    });
  }

  test("what claude reads from those files is what the wrapper wrote", async () => {
    const programData = tempDir();
    const host = await terminalHost(["João Silva", "data"]);
    const interactive = await launch(host, ["--persona", "qa"], { programData });
    const print = await launch(host, ["-p", "hi"], { programData });
    expect([
      interactive.start.appended?.endsWith(`\n\n${INDEX.text}`),
      interactive.start.mcpConfig !== null,
      Object.keys(print.start.agents ?? {}).length > 0,
    ]).toEqual([true, true, true]);
  });

  test("the files of one launch share one folder: restricted once, whatever the number of files", async () => {
    const programData = tempDir();
    const host = await terminalHost(["João Silva", "data"]);
    const run = await launch(host, ["--persona", "qa"], { programData });
    const folders = [
      argAfter(run.start.args, "--mcp-config"),
      argAfter(run.start.args, "--append-system-prompt-file"),
    ].map((p) => dirname(p ?? ""));
    expect([
      folders[0] === folders[1],
      folders[0]?.includes("Flightdeck-"),
      run.acls.length,
    ]).toEqual([true, true, 1]);
  });

  test("a data folder that is already plain keeps the files where they were: no folder, no icacls", async () => {
    const programData = tempDir();
    const host = await terminalHost(["data"]);
    const run = await launch(host, ["--persona", "qa"], { programData });
    const path = argAfter(run.start.args, "--append-system-prompt-file") ?? "";
    expect([
      path.startsWith(join(host.dataDir, "personas")),
      run.acls.length,
      readdirSync(programData),
    ]).toEqual([true, 0, []]);
  });

  test("when the plain folder cannot be had, the files stay where they were and the session opens without the channel", async () => {
    const programData = tempDir();
    const host = await terminalHost(["João Silva", "data"]);
    const run = await launch(host, ["--persona", "qa"], { programData, aclCode: 5 });
    const path = argAfter(run.start.args, "--append-system-prompt-file") ?? "";
    expect([
      path.startsWith(join(host.dataDir, "personas")),
      run.start.args.includes("--mcp-config"),
      readdirSync(programData),
      existsSync(path),
    ]).toEqual([true, false, [], false]);
  });
});

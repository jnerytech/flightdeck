import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { KnowledgeIndexResult } from "@flightdeck/protocol";
import { ExternalSessions } from "../src/central/external.ts";
import { type Receptor, startReceptor } from "../src/central/receptor.ts";
import { RECEPTOR_FILE } from "../src/central/wrapper.ts";
import { runCli } from "../src/main.ts";
import { packPersonas } from "../src/personas/pack.ts";
import { Personas } from "../src/personas/store.ts";
import { startServer } from "../src/server.ts";
import { SecretScanner } from "../src/snippets/model.ts";
import { EventStore } from "../src/store/event-store.ts";
import { installFakeClaude } from "./fake-claude.ts";
import { newManager, tempDir, workspace } from "./helpers.ts";

/** Issue #76: `flightdeckd claude` appends the library's index to the session's system prompt. */
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

/** A daemon the terminal talks to, with the library's index (or without it) and the personas. */
async function terminalHost(feed: ((path: string) => Promise<KnowledgeIndexResult>) | null) {
  const { root, project } = workspace();
  const dir = tempDir();
  const dataDir = join(dir, "data");
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
    ...(feed ? { knowledgeFeed: feed } : {}),
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
  return { file, project };
}

async function run(args: string[], host: { file: string; project: string }) {
  const fake = installFakeClaude([{ do: "exit", code: 0 }]);
  cleanups.push(fake.restore);
  await runCli(["claude", ...args], {
    env: { ...process.env, FLIGHTDECK_CONFIG: host.file },
    log: { log: () => {}, error: () => {} },
    exit: () => {},
    onSignal: () => {},
    selfCommand: [process.execPath, "run", join(import.meta.dir, "..", "src", "bin.ts")],
    cwd: host.project,
  });
  return fake.events().find((e) => e.type === "start") as unknown as {
    args: string[];
    appended: string | null;
    appendedPath: string | null;
    appendedModes: { file: number; dir: number } | null;
  };
}

describe("knowledge-feed-wrapper: the terminal's claude is given the index (#76)", () => {
  test("the index goes in a file claude is told to append, asked for the folder claude runs in, and the file goes away after", async () => {
    const asked: string[] = [];
    const host = await terminalHost(async (path) => {
      asked.push(path);
      return INDEX;
    });
    const start = await run(["--verbose"], host);
    expect(start.appended).toBe(INDEX.text);
    expect(start.args.filter((a) => a === "--append-system-prompt-file")).toHaveLength(1);
    expect(start.args).toContain("--verbose");
    expect(asked).toHaveLength(1);
    expect(existsSync(start.appendedPath as string)).toBe(false);
  });

  test("with a persona, one file holds the persona's body and then the index", async () => {
    const host = await terminalHost(async () => INDEX);
    const start = await run(["--persona", "qa"], host);
    expect(start.args.filter((a) => a === "--append-system-prompt-file")).toHaveLength(1);
    expect(start.appended).toMatch(/engenheiro de QA sênior/);
    expect(start.appended?.endsWith(`\n\n${INDEX.text}`)).toBe(true);
  });

  test("no flag when the host gives nothing: an empty index, or a host without the command", async () => {
    const empty = await run(
      [],
      await terminalHost(async () => ({ text: "", fed: 0, truncated: false })),
    );
    const without = await run([], await terminalHost(null));
    expect([empty, without].map((s) => s.args.includes("--append-system-prompt-file"))).toEqual([
      false,
      false,
    ]);
  });

  test("the user's own system prompt wins: nothing is appended beside it", async () => {
    const host = await terminalHost(async () => INDEX);
    const own = await run(["--append-system-prompt", "mine"], host);
    const ownFile = await run(["--append-system-prompt-file=/tmp/mine.md"], host);
    expect([own.appended, ownFile.appended]).toEqual([null, null]);
    expect(own.args).not.toContain("--append-system-prompt-file");
  });

  test("the file holding the index can be read by its owner only", async () => {
    const start = await run([], await terminalHost(async () => INDEX));
    // Windows has no such modes: only the owner's ACL there.
    const strangers = process.platform === "win32" ? 0 : 0o077;
    expect([
      (start.appendedModes?.file ?? 0o777) & strangers,
      (start.appendedModes?.dir ?? 0o777) & strangers,
    ]).toEqual([0, 0]);
  });
});

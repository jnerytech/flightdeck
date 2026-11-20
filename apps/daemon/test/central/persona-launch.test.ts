import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCli } from "../../src/main.ts";
import { packPersonas } from "../../src/personas/pack.ts";
import { Personas } from "../../src/personas/store.ts";
import { startServer } from "../../src/server.ts";
import { SecretScanner } from "../../src/snippets/domain/model.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { git } from "../support/board-helpers.ts";
import { installFakeClaude } from "../support/fake-claude.ts";
import { newManager, tempDir, workspace } from "../support/helpers.ts";

// A real daemon server and a fake claude process: more than the default 5 s.
setDefaultTimeout(40_000);

const TOKEN = "t".repeat(32);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** A daemon with the persona pack, and the config a terminal of its host reads. */
function host() {
  const { root, project } = workspace();
  const dir = tempDir();
  const dataDir = join(dir, "data");
  mkdirSync(dataDir, { recursive: true });
  const personas = new Personas({
    db: new EventStore(":memory:").db,
    allowedRoots: [root],
    scanner: new SecretScanner(),
    pack: packPersonas,
  });
  const server = startServer({
    manager: newManager().manager,
    personas: { store: personas },
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
    JSON.stringify({
      token: TOKEN,
      port: server.port,
      dataDir,
      hooks: { port: 0, token: "h".repeat(24) },
    }),
  );
  return { file, project };
}

/** `flightdeckd <argv>` in the project folder: what it said, its exit code and what claude was started with. */
async function run(argv: string[], folder = "", before: (project: string) => void = () => {}) {
  const where = host();
  const cwd = join(where.project, folder);
  mkdirSync(cwd, { recursive: true });
  before(where.project);
  const fake = installFakeClaude([{ do: "exit", code: 0 }]);
  cleanups.push(fake.restore);
  const said: string[] = [];
  let code = null as number | null;
  await runCli(argv, {
    env: { ...process.env, FLIGHTDECK_CONFIG: where.file },
    log: { log: (m) => said.push(m), error: (m) => said.push(m) },
    exit: (c) => {
      code = c;
    },
    onSignal: () => {},
    selfCommand: [process.execPath, "run", join(import.meta.dir, "../../src/bin.ts")],
    cwd,
  });
  const started = fake.events().find((e) => e.type === "start");
  return {
    said: said.join("\n"),
    code,
    claudeArgs: (started?.args as string[] | undefined) ?? null,
  };
}

describe("persona launch: `flightdeckd new <persona>` (#3426)", () => {
  test("a pack persona opens claude with its system prompt file", async () => {
    const { code, claudeArgs } = await run(["new", "qa"]);
    expect([code, claudeArgs?.includes("--append-system-prompt-file")]).toEqual([0, true]);
  });

  test("an id that does not exist is refused with exit 1 and the ids that do", async () => {
    const { code, said, claudeArgs } = await run(["new", "nope"]);
    expect({ code, claudeStarted: claudeArgs !== null }).toEqual({ code: 1, claudeStarted: false });
    expect(said).toContain("persona nope: ");
    for (const id of ["architect", "qa", "reviewer"]) expect(said, id).toContain(id);
  });
});

/** The `--name` values claude was started with. */
const names = (claudeArgs: string[] | null) =>
  (claudeArgs ?? []).flatMap((arg) =>
    arg.startsWith("--name=") ? [arg.slice("--name=".length)] : [],
  );

describe("persona launch: the session is named after the repo and the persona (#3432)", () => {
  test("a persona launched from a subfolder of a git repo names it <repo>-<persona>", async () => {
    const { claudeArgs } = await run(["new", "qa"], "flightdeck/apps/daemon", (project) => {
      git(join(project, "flightdeck"), "init", "-q");
    });
    expect(names(claudeArgs)).toEqual(["flightdeck-qa"]);
  });

  test("a launch with no persona, outside a git repo, is named after its folder", async () => {
    const { claudeArgs } = await run(["claude"], "notes");
    expect(names(claudeArgs)).toEqual(["notes"]);
  });

  test("a name the person passed is the only one claude gets", async () => {
    const { claudeArgs } = await run(["new", "qa", "-n", "mine"], "flightdeck");
    expect(names(claudeArgs)).toEqual([]);
    expect(claudeArgs).toContain("-n");
  });
});

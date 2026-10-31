import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs, runCli } from "../src/main.ts";
import { startServer } from "../src/server.ts";
import { SecretScanner } from "../src/snippets/model.ts";
import { Snippets } from "../src/snippets/store.ts";
import { EventStore } from "../src/store/event-store.ts";
import { newManager, tempDir, workspace } from "./helpers.ts";

setDefaultTimeout(20_000);

const TOKEN = "snippets-cli-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** A daemon with a host snippet and a project's versioned one, and `flightdeckd snippet …`. */
async function setup() {
  const { root, project } = workspace();
  const store = new EventStore(":memory:");
  const snippets = new Snippets({
    db: store.db,
    allowedRoots: [root],
    scanner: new SecretScanner(),
  });
  const server = startServer({
    manager: newManager().manager,
    snippets,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [root],
  });
  cleanups.push(() => server.stop());
  const file = join(tempDir(), "config.json");
  writeFileSync(
    file,
    JSON.stringify({ token: TOKEN, port: server.port, dataDir: join(tempDir(), "data") }),
  );
  mkdirSync(join(project, ".flightdeck"), { recursive: true });
  writeFileSync(
    join(project, ".flightdeck", "snippets.yaml"),
    '- name: revisar\n  type: prompt\n  text: "Revise {{file}}"\n',
  );
  snippets.save({
    scope: "host",
    name: "status",
    type: "command",
    run: "git status",
    tags: ["git"],
  });
  const run = async (...args: string[]) => {
    const out: string[] = [];
    const errors: string[] = [];
    const exits: number[] = [];
    await runCli([...args, "--config", file], {
      env: {},
      log: { log: (m) => out.push(m), error: (m) => errors.push(m) },
      exit: (code) => exits.push(code),
      onSignal: () => {},
    });
    return { out: out.join("\n"), errors: errors.join("\n"), exits };
  };
  return { run, project };
}

describe("snippets-cli: flightdeckd snippet list and get, the bridge the mod uses", () => {
  test("parseArgs: snippet list with --project-path and --query, snippet get with a name", () => {
    expect(parseArgs(["snippet", "list", "--project-path", "/p", "--query", "git"])).toMatchObject({
      command: "snippet",
      action: "list",
      projectPath: "/p",
      query: "git",
    });
    expect(parseArgs(["snippet", "get", "revisar"])).toMatchObject({
      command: "snippet",
      action: "get",
      snippetName: "revisar",
    });
    expect(() => parseArgs(["snippet", "apagar"])).toThrow("snippet");
    expect(() => parseArgs(["snippet", "get"])).toThrow("nome");
  });

  test("snippet list prints the host's and the project's snippets as JSON", async () => {
    const { run, project } = await setup();
    const done = await run("snippet", "list", "--project-path", project);
    expect(done.exits).toEqual([0]);
    const names = (JSON.parse(done.out) as { snippets: Array<{ name: string }> }).snippets
      .map((s) => s.name)
      .sort();
    expect(names).toEqual(["revisar", "status"]);
    const filtered = await run("snippet", "list", "--query", "git");
    expect(JSON.parse(filtered.out).snippets.map((s: { name: string }) => s.name)).toEqual([
      "status",
    ]);
  });

  test("snippet get prints one snippet's text by name, and an unknown one is an error with exit 1", async () => {
    const { run, project } = await setup();
    const done = await run("snippet", "get", "revisar", "--project-path", project);
    expect(done.exits).toEqual([0]);
    expect(JSON.parse(done.out)).toMatchObject({ name: "revisar", text: "Revise {{file}}" });
    const missing = await run("snippet", "get", "nada");
    expect(missing.exits).toEqual([1]);
    expect(missing.errors).toContain("not_found");
  });

  test("with no daemon up, snippet list says it could not connect, with exit 1", async () => {
    const dead = join(tempDir(), "config.json");
    writeFileSync(
      dead,
      JSON.stringify({ token: TOKEN, port: 1, dataDir: join(tempDir(), "data") }),
    );
    const errors: string[] = [];
    const exits: number[] = [];
    await runCli(["snippet", "list", "--config", dead], {
      env: {},
      log: { log: () => {}, error: (m) => errors.push(m) },
      exit: (code) => exits.push(code),
      onSignal: () => {},
    });
    expect(exits).toEqual([1]);
    expect(errors.join(" ")).toContain("não consegui conectar no daemon");
  });
});

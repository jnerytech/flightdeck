import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { BgService } from "../src/bg/service.ts";
import { ExternalSessions } from "../src/central/external.ts";
import { startReceptor } from "../src/central/receptor.ts";
import { FlightdeckError } from "../src/errors.ts";
import { runCli } from "../src/main.ts";
import { startServer } from "../src/server.ts";
import { EventStore } from "../src/store/event-store.ts";
import { whichOnPath } from "../src/which.ts";
import { installFakeClaude } from "./fake-claude.ts";
import { newManager, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "bg-start-token-0123456789a";
const HOOKS = "hooks-token-0123456789";
const BIN = join(import.meta.dir, "../src/bin.ts");
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** A host config with a live hooks receptor published, like the daemon does. */
function host() {
  const dir = tempDir();
  const dataDir = join(dir, "data");
  const work = join(dir, "work");
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(work, { recursive: true });
  const store = new EventStore(":memory:");
  const external = new ExternalSessions({ db: store.db, staleAfterS: 900 });
  const receptor = startReceptor({ port: 0, token: () => HOOKS, external, isManaged: () => false });
  cleanups.push(() => receptor.stop());
  writeFileSync(join(dataDir, "receptor.json"), JSON.stringify({ url: receptor.url }));
  const configFile = join(dir, "config.json");
  writeFileSync(
    configFile,
    JSON.stringify({
      token: "t".repeat(32),
      dataDir,
      allowedRoots: [work],
      hooks: { port: 0, token: HOOKS },
    }),
  );
  return { dir, dataDir, work, configFile };
}

describe("bg-iniciar: flightdeckd claude --bg", () => {
  test("claude is started in the background with the channel, and the files the session needs stay", async () => {
    const fake = installFakeClaude([]);
    cleanups.push(fake.restore);
    const { dataDir, configFile } = host();
    const out: string[] = [];
    await runCli(["claude", "--bg", "--name", "faxina", "limpe os logs"], {
      env: { ...process.env, FLIGHTDECK_CONFIG: configFile },
      log: { log: (m) => out.push(m), error: (m) => out.push(m) },
      exit: () => {},
      onSignal: () => {},
      selfCommand: ["C:\\fd\\flightdeckd.exe"],
    });
    const start = fake.events().find((e) => e.type === "start") as unknown as { args: string[] };
    expect(start.args).toContain("--bg");
    expect(start.args).toContain("--dangerously-load-development-channels");
    expect(start.args.slice(-3)).toEqual(["--name", "faxina", "limpe os logs"]);
    // The session outlives this command: its channel config must still be there.
    expect(readdirSync(join(dataDir, "channels"))).toHaveLength(1);
  });

  test("without --bg the files are still removed when claude ends", async () => {
    const fake = installFakeClaude([{ do: "exit", code: 0 }]);
    cleanups.push(fake.restore);
    const { dataDir, configFile } = host();
    await runCli(["claude", "-c"], {
      env: { ...process.env, FLIGHTDECK_CONFIG: configFile },
      log: { log: () => {}, error: () => {} },
      exit: () => {},
      onSignal: () => {},
      selfCommand: ["C:\\fd\\flightdeckd.exe"],
    });
    expect(
      existsSync(join(dataDir, "channels")) ? readdirSync(join(dataDir, "channels")) : [],
    ).toEqual([]);
  });
});

describe("bg-iniciar: bg.start", () => {
  /** A stand-in for `flightdeckd`: records how it was called and says what `claude --bg` says. */
  function stub(output = "backgrounded · stub01 · faxina\n", code = 0) {
    const dir = tempDir();
    const script = join(dir, "self.ts");
    const record = join(dir, "called.json");
    writeFileSync(
      script,
      `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(record)}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), config: process.env.FLIGHTDECK_CONFIG }));
process.stdout.write(${JSON.stringify(output)});
process.stderr.write(${JSON.stringify(code === 0 ? "" : "persona nope")});
process.exit(${code});
`,
    );
    return {
      self: [process.execPath, "run", script],
      called: () =>
        JSON.parse(readFileSync(record, "utf8")) as { argv: string[]; cwd: string; config: string },
    };
  }
  function service(self: string[]) {
    const h = host();
    const bg = new BgService({
      db: new EventStore(":memory:").db,
      claude: () => "claude",
      start: { self, configFile: h.configFile, allowedRoots: [h.work] },
    });
    return { h, bg };
  }

  test("it runs flightdeckd claude --bg in the folder with the persona, the name and the prompt, and answers with the id", async () => {
    const { self, called } = stub();
    const { h, bg } = service(self);
    expect(
      await bg.start({ cwd: h.work, prompt: "limpe os logs", name: "faxina", persona: "revisor" }),
    ).toEqual({ id: "stub01" });
    const run = called();
    expect(run.argv).toEqual([
      "claude",
      "--bg",
      "--persona",
      "revisor",
      "--name",
      "faxina",
      "--",
      "limpe os logs",
    ]);
    expect(realpathSync(run.cwd)).toBe(realpathSync(h.work));
    expect(run.config).toBe(h.configFile);
  });

  test("a folder outside the allowed ones is refused before anything runs", async () => {
    const { self } = stub();
    const { bg } = service(self);
    const outside = await bg.start({ cwd: tempDir(), prompt: "x" }).catch((e) => e);
    expect(outside).toBeInstanceOf(FlightdeckError);
    expect((outside as FlightdeckError).code).toBe("forbidden_cwd");
  });

  test("a flightdeckd that fails, or does not say an id, is reported with what it said", async () => {
    const refused = stub("", 1);
    const first = (await service(refused.self)
      .bg.start({ cwd: host().work, prompt: "x" })
      .catch((e) => e)) as FlightdeckError;
    expect(first.reason).toBe("bg_cli_failed");
    expect(String(first.params?.message)).toContain("persona nope");
    const silent = stub("started\n");
    const { h, bg } = service(silent.self);
    const second = (await bg
      .start({ cwd: h.work, prompt: "x" })
      .catch((e) => e)) as FlightdeckError;
    expect(second.reason).toBe("bg_cli_failed");
  });
});

describe("bg-iniciar: over the protocol", () => {
  test("bg.start answers with the id", async () => {
    const fake = installFakeClaude([]);
    cleanups.push(fake.restore);
    const h = host();
    const bg = new BgService({
      db: new EventStore(":memory:").db,
      claude: () => whichOnPath("claude"),
      start: {
        self: [process.execPath, "run", BIN],
        configFile: h.configFile,
        allowedRoots: [h.work],
      },
    });
    const { manager, root } = newManager();
    const server = startServer({
      manager,
      bg,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root, h.work],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    expect(await client.data("bg.start", { cwd: h.work, prompt: "oi" })).toEqual({
      id: "fake0001",
    });
  });
});

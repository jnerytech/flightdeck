import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ExternalSessions } from "../src/central/external.ts";
import { type Receptor, startReceptor } from "../src/central/receptor.ts";
import { RECEPTOR_FILE } from "../src/central/wrapper.ts";
import { runCli } from "../src/main.ts";
import { startServer } from "../src/server.ts";
import { EventStore } from "../src/store/event-store.ts";
import {
  type TerminalInfo,
  TerminalManager,
  type TerminalManagerOptions,
} from "../src/terminal/terminal-manager.ts";
import { installFakeClaude } from "./fake-claude.ts";
import { newManager, poll, tempDir, workspace } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";
import { fakePtys, pipedRunner } from "./pty-helpers.ts";

// Real processes (flightdeckd, the fake claude): more than the default 5 s.
setDefaultTimeout(40_000);

const HOOKS = "hooks-token-0123456789";
const TOKEN = "claude-here-token-0123456789abcdef";
const BIN = join(import.meta.dir, "..", "src", "bin.ts");
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** A config with the hooks token and a live receptor published in its data dir, like the daemon. */
function hostConfig() {
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
  const file = join(dir, "config.json");
  writeFileSync(
    file,
    JSON.stringify({ token: "t".repeat(32), dataDir, hooks: { port: 0, token: HOOKS } }),
  );
  return { file, dataDir, receptor, external };
}

/** The terminal manager of a host whose `flightdeckd` is /opt/fd/flightdeckd. */
function setup(overrides: Partial<TerminalManagerOptions> = {}) {
  const { root, project } = workspace();
  const ptys = fakePtys();
  const manager = new TerminalManager({
    pty: ptys.factory,
    allowedRoots: [root],
    platform: "linux",
    env: () => ({ PATH: "/bin", ANTHROPIC_API_KEY: "sk-secreta" }),
    claude: { self: ["/opt/fd/flightdeckd"], configFile: "/home/u/.flightdeck/config.json" },
    ...overrides,
  });
  cleanups.push(() => manager.stop());
  return { manager, ptys, root, project };
}

describe("claude-aqui", () => {
  test("claude abre flightdeckd claude no cwd, com o FLIGHTDECK_CONFIG do daemon e um launch id próprio do terminal", () => {
    const { manager, ptys, project } = setup();
    const info = manager.open({ cwd: project, claude: {}, cols: 120, rows: 40 });
    expect(info.launchId ?? "").toMatch(/^[0-9A-Z]{26}$/);
    expect(info).toMatchObject({ cwd: project, command: "flightdeckd", cols: 120, rows: 40 });
    expect(ptys.spawned[0]).toMatchObject({
      argv: ["/opt/fd/flightdeckd", "claude"],
      cwd: project,
      env: {
        PATH: "/bin",
        FLIGHTDECK_CONFIG: "/home/u/.flightdeck/config.json",
        FLIGHTDECK_TERMINAL_LAUNCH_ID: info.launchId,
      },
    });
    // The same API-key rule as every terminal and every managed session.
    expect(ptys.spawned[0]?.env.ANTHROPIC_API_KEY).toBeUndefined();
    const resumed = manager.open({
      cwd: project,
      claude: { resume: "abc-123" },
      cols: 80,
      rows: 24,
    });
    expect(ptys.spawned[1]?.argv).toEqual(["/opt/fd/flightdeckd", "claude", "--resume", "abc-123"]);
    expect(resumed.launchId).not.toBe(info.launchId);
    expect(manager.list().map((t) => t.launchId)).toEqual([info.launchId, resumed.launchId]);
    // A plain terminal has no launch.
    expect(manager.open({ cwd: project, command: ["sh"], cols: 80, rows: 24 }).launchId).toBeNull();
  });

  test("Claude aqui with a persona runs flightdeckd claude --persona <id> (phase 20)", () => {
    const { manager, ptys, project } = setup();
    manager.open({ cwd: project, claude: { persona: "seguranca" }, cols: 80, rows: 24 });
    expect(ptys.spawned[0]?.argv).toEqual([
      "/opt/fd/flightdeckd",
      "claude",
      "--persona",
      "seguranca",
    ]);
    manager.open({
      cwd: project,
      claude: { resume: "abc-123", persona: "qa" },
      cols: 80,
      rows: 24,
    });
    expect(ptys.spawned[1]?.argv).toEqual([
      "/opt/fd/flightdeckd",
      "claude",
      "--resume",
      "abc-123",
      "--persona",
      "qa",
    ]);
  });

  test("sem flightdeckd configurado, o Claude aqui é recusado", () => {
    const { manager, project } = setup({ claude: undefined });
    let code = "ok";
    try {
      manager.open({ cwd: project, claude: {}, cols: 80, rows: 24 });
    } catch (error) {
      code = (error as { code?: string }).code ?? "sem código";
    }
    expect(code).toBe("invalid_state");
  });

  test("pelo protocolo: claude e command juntos, ou um resume que não é um id, são recusados", async () => {
    const { manager, ptys, root, project } = setup();
    const server = startServer({
      manager: newManager().manager,
      terminals: manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const open = async (extra: Record<string, unknown>) => {
      const ack = await client.request("terminal.open", {
        cwd: project,
        cols: 80,
        rows: 24,
        ...extra,
      });
      return (ack.error as { code?: string } | undefined)?.code ?? "ok";
    };
    expect(await open({ claude: {}, command: ["sh"] })).toBe("bad_request");
    for (const resume of ["--dangerously", "-x", "a b", "a;b", "", "x".repeat(200)]) {
      expect([resume.slice(0, 12), await open({ claude: { resume } })]).toEqual([
        resume.slice(0, 12),
        "bad_request",
      ]);
    }
    expect(ptys.spawned).toEqual([]);
    expect(await open({ claude: { resume: "0b1c2d3e-4f50-6789-abcd-ef0123456789" } })).toBe("ok");
    expect(await open({ claude: {} })).toBe("ok");
    expect(ptys.spawned.map((p) => p.argv.length)).toEqual([4, 2]);
  });

  test("o wrapper usa o launch id que o terminal pediu e o tira do ambiente do claude; um id inválido é ignorado", async () => {
    const fake = installFakeClaude([{ do: "exit", code: 0 }]);
    cleanups.push(fake.restore);
    const { file } = hostConfig();
    const run = async (id: string | undefined) => {
      const env: Record<string, string | undefined> = { ...process.env, FLIGHTDECK_CONFIG: file };
      env.FLIGHTDECK_TERMINAL_LAUNCH_ID = id;
      let code = null as number | null;
      await runCli(["claude"], {
        env,
        log: { log: () => {}, error: () => {} },
        exit: (c) => {
          code = c;
        },
        onSignal: () => {},
        selfCommand: ["C:\\fd\\flightdeckd.exe"],
      });
      return code;
    };
    expect(await run("01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe(0);
    expect(await run("../../fora")).toBe(0);
    expect(await run(undefined)).toBe(0);
    const starts = fake.events().filter((e) => e.type === "start") as unknown as Array<{
      env: Record<string, string>;
    }>;
    expect(starts.map((s) => s.env.FLIGHTDECK_LAUNCH_ID)).toEqual([
      "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      expect.stringMatching(/^[0-9A-Z]{26}$/),
      expect.stringMatching(/^[0-9A-Z]{26}$/),
    ]);
    expect(starts[1]?.env.FLIGHTDECK_LAUNCH_ID).not.toBe("../../fora");
    // The request is not passed down: a flightdeckd claude inside claude would reuse it.
    expect(starts.map((s) => s.env.FLIGHTDECK_TERMINAL_LAUNCH_ID)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  test("de ponta a ponta: o terminal roda flightdeckd claude, o claude falso nasce com o launch id do terminal e o canal dele recebe mensagens", async () => {
    const fake = installFakeClaude([
      { do: "channel" },
      { do: "wait-channel", count: 1 },
      { do: "exit", code: 0 },
    ]);
    cleanups.push(fake.restore);
    const host = hostConfig();
    const { root, project } = workspace();
    const manager = new TerminalManager({
      pty: pipedRunner(process.execPath),
      allowedRoots: [root],
      claude: { self: [process.execPath, "run", BIN], configFile: host.file },
    });
    cleanups.push(() => manager.stop());
    let info: TerminalInfo | null = null;
    let failure = "";
    try {
      info = manager.open({ cwd: project, claude: {}, cols: 80, rows: 24 });
    } catch (error) {
      failure = (error as Error).message;
    }
    expect(failure).toBe("");
    const launchId = info?.launchId ?? "";
    // The claude that flightdeckd started carries the terminal's launch id…
    const start = await poll(() => fake.events().find((e) => e.type === "start"), 30_000);
    const env = (start as unknown as { env: Record<string, string> } | null)?.env ?? {};
    expect(env.FLIGHTDECK_LAUNCH_ID).toBe(launchId);
    // …and the channel of that launch takes the app's messages: the session is controllable.
    expect(await poll(() => host.receptor.sendToLaunch(launchId, "oi"), 30_000)).toBe(true);
    // The terminal ends with the claude that ran in it.
    expect(await poll(() => manager.list()[0]?.exitCode === 0, 30_000)).toBe(true);
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ExternalSessions } from "../src/central/external.ts";
import { startReceptor } from "../src/central/receptor.ts";
import { buildClaudeLaunch, RECEPTOR_FILE } from "../src/central/wrapper.ts";
import { runCli } from "../src/main.ts";
import { EventStore } from "../src/store/event-store.ts";
import { installFakeClaude } from "./fake-claude.ts";
import { tempDir } from "./helpers.ts";

const HOOKS = "hooks-token-0123456789";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** Config with the hooks token; `receptor` publishes a live receptor's URL like the daemon. */
function config(options: { receptor?: string; executablePath?: string } = {}) {
  const dir = tempDir();
  const dataDir = join(dir, "data");
  mkdirSync(dataDir, { recursive: true });
  const file = join(dir, "config.json");
  writeFileSync(
    file,
    JSON.stringify({
      token: "t".repeat(32),
      dataDir,
      hooks: { port: 0, token: HOOKS },
      ...(options.executablePath ? { claude: { executablePath: options.executablePath } } : {}),
    }),
  );
  if (options.receptor) {
    writeFileSync(join(dataDir, RECEPTOR_FILE), JSON.stringify({ url: options.receptor }));
  }
  return { file, dataDir };
}

function receptor() {
  const store = new EventStore(":memory:");
  const external = new ExternalSessions({ db: store.db, staleAfterS: 900 });
  const server = startReceptor({ port: 0, token: () => HOOKS, external, isManaged: () => false });
  cleanups.push(() => server.stop());
  return server.url;
}

async function wrapper(args: string[], configFile: string) {
  const out: string[] = [];
  let code = null as number | null;
  await runCli(["claude", ...args], {
    env: { ...process.env, FLIGHTDECK_CONFIG: configFile },
    log: { log: (m) => out.push(m), error: (m) => out.push(m) },
    exit: (c) => {
      code = c;
    },
    onSignal: () => {},
    selfCommand: ["C:\\fd\\flightdeckd.exe"],
  });
  return { code, out };
}

describe("wrapper", () => {
  test("monta os argumentos: o canal, o --mcp-config e depois os do usuário", () => {
    expect(
      buildClaudeLaunch({
        claude: "C:\\npm\\claude.cmd",
        args: ["--model", "opus", "-p", "oi"],
        mcpConfigPath: "D:\\data\\channels\\L1.json",
      }),
    ).toEqual([
      "C:\\npm\\claude.cmd",
      "--mcp-config",
      "D:\\data\\channels\\L1.json",
      "--dangerously-load-development-channels",
      "server:flightdeck",
      "--model",
      "opus",
      "-p",
      "oi",
    ]);
    expect(buildClaudeLaunch({ claude: "/bin/claude", args: ["-c"], mcpConfigPath: null })).toEqual(
      ["/bin/claude", "-c"],
    );
  });

  test("acha o claude no PATH, repassa argumentos e código de saída, com o canal e o launch id", async () => {
    const fake = installFakeClaude([{ do: "exit", code: 7 }]);
    cleanups.push(fake.restore);
    const url = receptor();
    const { file, dataDir } = config({ receptor: url });
    const result = await wrapper(["--model", "opus", "-p", "oi"], file);
    expect(result.code).toBe(7);
    const start = fake.events().find((e) => e.type === "start") as unknown as {
      args: string[];
      env: Record<string, string>;
      mcpConfig: { mcpServers: Record<string, { command: string; args: string[] }> };
    };
    const launch = start.env.FLIGHTDECK_LAUNCH_ID ?? "";
    expect(launch).toMatch(/^[0-9A-Z]{26}$/);
    expect(start.args.slice(2)).toEqual([
      "--dangerously-load-development-channels",
      "server:flightdeck",
      "--model",
      "opus",
      "-p",
      "oi",
    ]);
    expect(start.mcpConfig).toEqual({
      mcpServers: {
        flightdeck: {
          command: "C:\\fd\\flightdeckd.exe",
          args: ["channel", "--launch", launch, "--url", url, "--token", HOOKS],
        },
      },
    });
    // The --mcp-config file is temporary.
    expect(readdirSync(join(dataDir, "channels"))).toEqual([]);
  });

  test("com o daemon fora do ar, avisa e abre o claude assim mesmo, sem canal", async () => {
    const fake = installFakeClaude([{ do: "exit", code: 0 }]);
    cleanups.push(fake.restore);
    const closed = Bun.serve({ port: 0, fetch: () => new Response("") });
    const url = `http://127.0.0.1:${closed.port}`;
    await closed.stop(true);
    for (const options of [{}, { receptor: url }]) {
      const { file } = config(options);
      const result = await wrapper(["-c"], file);
      expect(result.code).toBe(0);
      expect(result.out.join("\n")).toContain("daemon do Flightdeck fora do ar");
    }
    const starts = fake.events().filter((e) => e.type === "start");
    expect(starts.map((e) => e.args)).toEqual([["-c"], ["-c"]]);
  });

  test("usa claude.executablePath da config antes do PATH", async () => {
    const fake = installFakeClaude([{ do: "exit", code: 3 }]);
    cleanups.push(fake.restore);
    const chosen = join(fake.dir, process.platform === "win32" ? "claude.cmd" : "claude");
    fake.restore();
    const { file } = config({ executablePath: chosen });
    expect((await wrapper([], file)).code).toBe(3);
    expect(fake.events().some((e) => e.type === "start")).toBe(true);
  });

  test("sem claude no PATH avisa com uma linha clara", async () => {
    const { file } = config();
    const saved = process.env.PATH;
    process.env.PATH = tempDir();
    try {
      const result = await wrapper([], file);
      expect(result.code).toBe(1);
      expect(result.out.join("\n")).toContain("claude não encontrado");
    } finally {
      process.env.PATH = saved;
    }
    expect(existsSync(file)).toBe(true);
  });
});

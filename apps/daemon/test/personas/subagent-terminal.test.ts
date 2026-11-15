import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  INLINE_AGENTS_MAX,
  interactiveAgents,
} from "../../src/central/domain/claude-launch-args.ts";
import { runCli } from "../../src/main.ts";
import { installFakeClaude } from "../support/fake-claude.ts";
import { tempDir } from "../support/helpers.ts";
import {
  cleanups,
  HOOKS,
  SECURITY,
  setup,
  TOKEN,
  teardown,
  terminalHost,
} from "./subagent-setup.ts";

setDefaultTimeout(40_000);
afterEach(teardown);

describe("personas-subagente: o terminal, flightdeckd claude --agents", () => {
  async function run(
    args: string[],
    host: { file: string },
    cwd?: string,
    platform?: NodeJS.Platform,
    errors: string[] = [],
  ) {
    const exit = { code: null as number | null };
    await runCli(["claude", ...args], {
      ...(platform ? { platform } : {}),
      env: { ...process.env, FLIGHTDECK_CONFIG: host.file },
      log: { log: () => {}, error: (m: string) => errors.push(m) },
      exit: (c) => {
        exit.code = c;
      },
      onSignal: () => {},
      selfCommand: [process.execPath, "run", join(import.meta.dir, "../../src/bin.ts")],
      ...(cwd ? { cwd } : {}),
    });
    return exit.code;
  }

  const startsOf = (fake: ReturnType<typeof installFakeClaude>) =>
    fake.events().filter((e) => e.type === "start") as unknown as Array<{
      args: string[];
      agents: Record<string, { description: string; prompt: string }> | null;
      agentsPath: string | null;
      agentsInline: boolean;
    }>;

  test("interactive claude gets --agents as inline JSON, never a file path", async () => {
    const { root, project, personas } = setup();
    const host = await terminalHost(personas, root);
    const fake = installFakeClaude([{ do: "exit", code: 0 }]);
    cleanups.push(fake.restore);
    expect(await run([], host, project)).toBe(0);
    const [start] = startsOf(fake);
    // The Windows runner finds the fake as claude.cmd, a shim that gets no --agents at all.
    if (process.platform === "win32") {
      expect(start?.args).not.toContain("--agents");
      return;
    }
    expect(start?.args).toContain("--agents");
    const value = start?.args[(start?.args.indexOf("--agents") ?? 0) + 1] ?? "";
    expect(value.startsWith("{")).toBe(true);
    expect(start?.agentsInline).toBe(true);
    expect(Object.keys(start?.agents ?? {})).toContain("persona-revisor");
    expect(start?.agents?.["persona-revisor"]?.description).toMatch(/Revisa legibilidade/);
  });

  test("print mode keeps the file, which exists while claude runs and is gone after", async () => {
    const { root, project, personas } = setup();
    const host = await terminalHost(personas, root);
    const fake = installFakeClaude([{ do: "exit", code: 0 }]);
    cleanups.push(fake.restore);
    expect(await run(["-p", "oi"], host, project)).toBe(0);
    const [start] = startsOf(fake);
    expect(start?.agentsInline).toBe(false);
    expect(Object.keys(start?.agents ?? {})).toContain("persona-revisor");
    const { existsSync } = await import("node:fs");
    expect(existsSync(start?.agentsPath as string)).toBe(false);
  });

  test("agents too long for a Windows command line are dropped, and the user is told", async () => {
    const { root, project, personas } = setup();
    for (const id of ["grande", "enorme"]) {
      await personas.save({ scope: "host", persona: { ...SECURITY, id, body: "x".repeat(7_000) } });
    }
    const host = await terminalHost(personas, root);
    const fake = installFakeClaude([{ do: "exit", code: 0 }]);
    cleanups.push(fake.restore);
    const errors: string[] = [];
    const exit = { code: null as number | null };
    await runCli(["claude"], {
      env: { ...process.env, FLIGHTDECK_CONFIG: host.file },
      log: { log: () => {}, error: (m: string) => errors.push(m) },
      exit: (c) => {
        exit.code = c;
      },
      onSignal: () => {},
      selfCommand: [process.execPath, "run", join(import.meta.dir, "../../src/bin.ts")],
      cwd: project,
    });
    expect(exit.code).toBe(0);
    expect(startsOf(fake)[0]?.args).not.toContain("--agents");
    expect(errors.join("\n")).toMatch(/--agents/);
  });

  test("junto de --persona: os dois arquivos, apagados no fim", async () => {
    const { root, project, personas } = setup();
    const host = await terminalHost(personas, root);
    const fake = installFakeClaude([{ do: "exit", code: 2 }]);
    cleanups.push(fake.restore);
    // Print mode: the agents travel in a file, which a Windows claude.cmd shim can take.
    expect(await run(["--persona", "qa", "-p", "oi"], host, project)).toBe(2);
    const [start] = startsOf(fake);
    expect(start?.args).toContain("--agents");
    expect(start?.args).toContain("--append-system-prompt-file");
    const { readdirSync } = await import("node:fs");
    expect(readdirSync(join(host.dataDir, "personas"))).toEqual([]);
  });

  test("o --agents do próprio usuário vale; sem o daemon, ou sem personas, o claude abre do mesmo jeito", async () => {
    const { root, project, personas } = setup();
    const host = await terminalHost(personas, root);
    const fake = installFakeClaude([{ do: "exit", code: 0 }]);
    cleanups.push(fake.restore);
    await run(["--agents", "{}"], host, project);
    const own = startsOf(fake)[0]?.args ?? [];
    expect(own.filter((a) => a === "--agents")).toHaveLength(1);
    expect(own[own.indexOf("--agents") + 1]).toBe("{}");
    await run(["--agents={}"], host, project);
    expect((startsOf(fake)[1]?.args ?? []).filter((a) => a.startsWith("--agents"))).toHaveLength(1);
    const down = join(tempDir(), "config.json");
    writeFileSync(
      down,
      JSON.stringify({
        token: TOKEN,
        port: 1,
        dataDir: tempDir(),
        hooks: { port: 0, token: HOOKS },
      }),
    );
    expect(await run([], { file: down }, project)).toBe(0);
    expect(startsOf(fake)[2]?.args).not.toContain("--agents");
    const bare = await terminalHost(null, root);
    expect(await run([], bare, project)).toBe(0);
    expect(startsOf(fake)[3]?.args).not.toContain("--agents");
  });
});

describe("personas-subagente: the --agents of an interactive claude", () => {
  const JSON_ARG = '{"persona-a":{"description":"d","prompt":"a & b (c)"}}';

  test("a native claude, or any claude off Windows, gets the JSON as it is", async () => {
    for (const [claude, platform] of [
      ["C:\\bin\\claude.exe", "win32"],
      ["C:\\bin\\claude", "win32"],
      ["/usr/bin/claude", "linux"],
      ["/usr/bin/claude.cmd", "darwin"],
    ] as const) {
      expect(interactiveAgents({ json: JSON_ARG, claude, platform })).toEqual({
        args: ["--agents", JSON_ARG],
        notice: null,
      });
    }
  });

  test("a Windows .cmd or .bat shim gets no --agents, in any case of the extension, and a notice says why", async () => {
    for (const claude of ["C:\\npm\\claude.cmd", "C:\\npm\\CLAUDE.BAT", "claude.Cmd"]) {
      const launch = interactiveAgents({ json: JSON_ARG, claude, platform: "win32" });
      expect(launch.args).toEqual([]);
      expect(launch.notice).toMatch(/claude\.cmd.*--agents/);
    }
  });

  test("a JSON past the limit gets no --agents and a notice with its size", async () => {
    const json = `{"x":"${"y".repeat(INLINE_AGENTS_MAX)}"}`;
    const launch = interactiveAgents({ json, claude: "/usr/bin/claude", platform: "linux" });
    expect(launch.args).toEqual([]);
    expect(launch.notice).toContain(`${json.length} characters`);
    const edge = "x".repeat(INLINE_AGENTS_MAX);
    expect(interactiveAgents({ json: edge, claude: "/c", platform: "linux" }).args).toEqual([
      "--agents",
      edge,
    ]);
  });
});

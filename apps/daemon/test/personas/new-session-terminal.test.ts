import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCli } from "../../src/main.ts";
import { packPersonas } from "../../src/personas/pack.ts";
import { Personas } from "../../src/personas/store.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { installFakeClaude } from "../support/fake-claude.ts";
import { tempDir, workspace } from "../support/helpers.ts";
import {
  cleanups,
  HOOKS,
  REVIEWER,
  scanner,
  TOKEN,
  teardown,
  terminalHost,
} from "./new-session-setup.ts";

// Real processes (flightdeckd, the fake claude): more than the default 5 s.
setDefaultTimeout(40_000);
afterEach(teardown);
describe("personas-sessao-nova: o terminal, flightdeckd claude --persona", () => {
  async function run(args: string[], host: { file: string }, cwd?: string) {
    const errors: string[] = [];
    const exit = { code: null as number | null };
    await runCli(["claude", ...args], {
      env: { ...process.env, FLIGHTDECK_CONFIG: host.file },
      log: { log: () => {}, error: (message) => errors.push(message) },
      exit: (c) => {
        exit.code = c;
      },
      onSignal: () => {},
      selfCommand: [process.execPath, "run", join(import.meta.dir, "../../src/bin.ts")],
      ...(cwd ? { cwd } : {}),
    });
    return { code: exit.code, errors };
  }

  const startOf = (fake: ReturnType<typeof installFakeClaude>) =>
    fake.events().find((e) => e.type === "start") as unknown as {
      args: string[];
      appended: string | null;
      appendedPath: string | null;
    };

  test("grava o corpo num arquivo temporário, passa --append-system-prompt-file, --model e --effort, e apaga o arquivo no fim", async () => {
    const { root, project } = workspace();
    const personas = new Personas({
      db: new EventStore(":memory:").db,
      allowedRoots: [root],
      scanner,
      pack: packPersonas,
    });
    const host = await terminalHost(personas, root);
    const fake = installFakeClaude([{ do: "exit", code: 0 }]);
    cleanups.push(fake.restore);
    const result = await run(["--persona", "qa", "--verbose"], host, project);
    expect(result.code).toBe(0);
    const start = startOf(fake);
    const args = start.args;
    expect(args).toContain("--append-system-prompt-file");
    expect(start.appended).toMatch(/engenheiro de QA sênior/);
    expect(args[args.indexOf("--model") + 1]).toBe("claude-sonnet-5-5");
    expect(args[args.indexOf("--effort") + 1]).toBe("medium");
    // The user's own arguments follow, untouched; --persona itself is not passed to claude.
    expect(args).toContain("--verbose");
    expect(args).not.toContain("--persona");
    // The file was there while claude ran and is gone when it ends.
    expect(start.appendedPath).not.toBeNull();
    expect(existsSync(start.appendedPath as string)).toBe(false);
  });

  test("ferramentas e modo plan vão junto; os argumentos do próprio usuário vencem", async () => {
    const { root, project } = workspace();
    const personas = new Personas({
      db: new EventStore(":memory:").db,
      allowedRoots: [root],
      scanner,
    });
    await personas.save({ scope: "host", persona: REVIEWER });
    const host = await terminalHost(personas, root);
    const fake = installFakeClaude([
      { do: "exit", code: 0 },
      { do: "exit", code: 0 },
    ]);
    cleanups.push(fake.restore);
    await run(["--persona=revisor-host"], host, project);
    const first = startOf(fake).args;
    expect(first).toContain("--tools=Read,Grep");
    expect(first[first.indexOf("--permission-mode") + 1]).toBe("plan");
    expect(first[first.indexOf("--model") + 1]).toBe("claude-opus-5-5");
    expect(first).not.toContain("--allowedTools");
    expect(first).not.toContain("--allowed-tools");
  });

  test("o que o usuário passou não é repetido pela persona, e --persona fora do começo é do claude", async () => {
    const { root, project } = workspace();
    const personas = new Personas({
      db: new EventStore(":memory:").db,
      allowedRoots: [root],
      scanner,
    });
    await personas.save({ scope: "host", persona: REVIEWER });
    const host = await terminalHost(personas, root);
    const fake = installFakeClaude([{ do: "exit", code: 0 }]);
    cleanups.push(fake.restore);
    await run(
      [
        "--persona",
        "revisor-host",
        "--model",
        "sonnet",
        "--effort",
        "low",
        "--tools",
        "Bash",
        "--permission-mode",
        "acceptEdits",
      ],
      host,
      project,
    );
    const args = startOf(fake).args;
    for (const flag of ["--model", "--effort", "--tools", "--permission-mode"]) {
      expect([flag, args.filter((a) => a === flag).length]).toEqual([flag, 1]);
    }
    expect(args[args.indexOf("--model") + 1]).toBe("sonnet");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("acceptEdits");
    expect(args).toContain("--append-system-prompt-file");
    // Past the first argument it is the user's own text for claude: left alone.
    await run(["--verbose", "--persona", "revisor-host"], host, project);
    const later = fake.events().filter((e) => e.type === "start")[1] as unknown as {
      args: string[];
    };
    expect(later.args.slice(-3)).toEqual(["--verbose", "--persona", "revisor-host"]);
    expect(later.args).not.toContain("--append-system-prompt-file");
  });

  test("o arquivo some também quando o claude falha, e sem --persona nada muda", async () => {
    const { root, project } = workspace();
    const personas = new Personas({
      db: new EventStore(":memory:").db,
      allowedRoots: [root],
      scanner,
      pack: packPersonas,
    });
    const host = await terminalHost(personas, root);
    const fake = installFakeClaude([{ do: "exit", code: 3 }]);
    cleanups.push(fake.restore);
    const failed = await run(["--persona", "sre"], host, project);
    expect(failed.code).toBe(3);
    expect(existsSync(startOf(fake).appendedPath as string)).toBe(false);
    const plain = await run(["--verbose"], host, project);
    const second = fake.events().filter((e) => e.type === "start")[1] as unknown as {
      args: string[];
      appendedPath: string | null;
    };
    expect(plain.code).toBe(3);
    expect(second.appendedPath).toBeNull();
    expect(second.args).not.toContain("--append-system-prompt-file");
  });

  test("persona que não existe, não confiável ou daemon fora do ar: o claude nem abre", async () => {
    const { root, project } = workspace();
    const personas = new Personas({
      db: new EventStore(":memory:").db,
      allowedRoots: [root],
      scanner,
    });
    const dir = join(project, ".flightdeck", "personas");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "do-projeto.md"),
      "---\nid: do-projeto\nname: P\ndescription: d\n---\nCorpo.\n",
    );
    const host = await terminalHost(personas, root);
    const fake = installFakeClaude([{ do: "exit", code: 0 }]);
    cleanups.push(fake.restore);
    const missing = await run(["--persona", "nada"], host, project);
    expect(missing.code).toBe(1);
    expect(missing.errors.join("\n")).toMatch(/nada/);
    const untrusted = await run(["--persona", "do-projeto"], host, project);
    expect(untrusted.code).toBe(1);
    expect(untrusted.errors.join("\n")).toMatch(/persona_untrusted|confie/);
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
    const offline = await run(["--persona", "qa"], { file: down }, project);
    expect(offline.code).toBe(1);
    expect(offline.errors.join("\n")).toMatch(/daemon/);
    const noValue = await run(["--persona"], host, project);
    expect(noValue.code).toBe(1);
    for (const args of [["--persona="], ["--persona", "--verbose"]]) {
      expect([args, (await run(args, host, project)).code]).toEqual([args, 1]);
    }
    expect(fake.events().filter((e) => e.type === "start")).toEqual([]);
  });

  test("fora das pastas permitidas só valem as personas do host e do pacote", async () => {
    const { root } = workspace();
    const personas = new Personas({
      db: new EventStore(":memory:").db,
      allowedRoots: [root],
      scanner,
      pack: packPersonas,
    });
    const host = await terminalHost(personas, root);
    const fake = installFakeClaude([{ do: "exit", code: 0 }]);
    cleanups.push(fake.restore);
    const outside = tempDir();
    const result = await run(["--persona", "docs"], host, outside);
    expect(result.code).toBe(0);
    expect(startOf(fake).appended).toMatch(/tech writer/i);
  });
});

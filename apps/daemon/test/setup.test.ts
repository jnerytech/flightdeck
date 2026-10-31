import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { createPrompt, runSetup, type SetupDeps } from "../src/setup.ts";
import { tempDir } from "./helpers.ts";

const TAILSCALE_NETWORKS = ["100.64.0.0/10", "fd7a:115c:a1e0::/48"];

function harness(
  options: {
    answers?: string[];
    confirms?: Record<string, boolean>;
    tailscale?: string | null;
    config?: object;
    serviceError?: string;
  } = {},
) {
  const home = tempDir("fd-setup-home-");
  const configFile = join(tempDir("fd-setup-"), "config.json");
  if (options.config) writeFileSync(configFile, JSON.stringify(options.config));
  const calls: string[] = [];
  const asked: string[] = [];
  const out: string[] = [];
  const deps: SetupDeps = {
    ask: async (question) => {
      asked.push(question);
      return answers.shift() ?? "";
    },
    confirm: async (question, fallback) => {
      asked.push(question);
      for (const [needle, answer] of Object.entries(options.confirms ?? {})) {
        if (question.includes(needle)) return answer;
      }
      return fallback;
    },
    log: { log: (m) => out.push(m), error: (m) => out.push(m) },
    configFile,
    home,
    isDirectory: (path) => path.startsWith(home) && !path.endsWith("missing"),
    tailscaleIp: async () => options.tailscale ?? null,
    installBinary: () => {
      calls.push("binary");
      return true;
    },
    installService: async () => {
      calls.push("service");
      if (options.serviceError) throw new Error(options.serviceError);
    },
    installHooks: () => {
      calls.push("hooks");
    },
    pair: async () => {
      calls.push("pair");
    },
  };
  const dir = (name: string) => {
    const path = join(home, name);
    mkdirSync(path, { recursive: true });
    return path;
  };
  // Unless a test says otherwise, the user gives one folder and then finishes.
  const answers = [...(options.answers ?? [dir("code"), ""])];
  return { deps, home, configFile, calls, asked, out, dir };
}

describe("setup", () => {
  test("walks the steps in order: binary, folders, hooks, service, pair link", async () => {
    const h = harness({ confirms: { hooks: true } });
    const a = h.dir("code");
    const b = h.dir("work");
    const answers = [a, b, ""];
    h.deps.ask = async () => answers.shift() ?? "";
    await runSetup(h.deps);
    expect(h.calls).toEqual(["binary", "hooks", "service", "pair"]);
    expect(loadConfig(h.configFile).allowedRoots).toEqual([a, b]);
  });

  test("a folder that does not exist is refused with the reason and asked again", async () => {
    const h = harness();
    const good = h.dir("code");
    const answers = [join(h.home, "missing"), good, ""];
    h.deps.ask = async () => answers.shift() ?? "";
    await runSetup(h.deps);
    expect(h.out.join("\n")).toContain("is not a folder that exists");
    expect(loadConfig(h.configFile).allowedRoots).toEqual([good]);
  });

  test("~ in a folder answer means the home, and folders already in the config stay", async () => {
    const h = harness({ config: { token: "t".repeat(32), allowedRoots: ["/srv/old"] } });
    h.dir("code");
    const answers = ["~/code", ""];
    h.deps.ask = async () => answers.shift() ?? "";
    await runSetup(h.deps);
    expect(loadConfig(h.configFile).allowedRoots).toEqual(["/srv/old", join(h.home, "code")]);
    expect(h.out.join("\n")).toContain("/srv/old");
  });

  test("with no folder at all it asks again until one is given or the user insists", async () => {
    const h = harness({ confirms: { "without project folders": false } });
    const good = h.dir("code");
    const answers = ["", good, ""];
    h.deps.ask = async () => answers.shift() ?? "";
    await runSetup(h.deps);
    expect(loadConfig(h.configFile).allowedRoots).toEqual([good]);
    const insist = harness({
      answers: [""],
      confirms: { "without project folders": true, hooks: false },
    });
    await runSetup(insist.deps);
    expect(loadConfig(insist.configFile).allowedRoots).toEqual([]);
    expect(insist.calls).toEqual(["binary", "service", "pair"]);
  });

  test("with Tailscale, saying yes listens on every interface but only lets Tailscale and loopback in", async () => {
    const h = harness({ tailscale: "100.64.0.9", confirms: { Tailscale: true } });
    const good = h.dir("code");
    const answers = [good, ""];
    h.deps.ask = async () => answers.shift() ?? "";
    await runSetup(h.deps);
    const config = loadConfig(h.configFile);
    expect(config.bind).toBe("0.0.0.0");
    expect(config.allowedNetworks).toEqual(["127.0.0.0/8", "::1/128", ...TAILSCALE_NETWORKS]);
  });

  test("with Tailscale, saying no keeps the daemon on the loopback; without Tailscale it never asks", async () => {
    const no = harness({ tailscale: "100.64.0.9", confirms: { Tailscale: false } });
    no.dir("code");
    await runSetup(no.deps);
    expect(loadConfig(no.configFile).bind).toBe("127.0.0.1");
    const none = harness();
    await runSetup(none.deps);
    expect(none.asked.some((q) => q.includes("Tailscale"))).toBe(false);
  });

  test("hooks are optional", async () => {
    const h = harness({ confirms: { hooks: false } });
    await runSetup(h.deps);
    expect(h.calls).not.toContain("hooks");
  });

  test("a service that never answers stops the wizard before the pair link and says what to run", async () => {
    const h = harness({ serviceError: "the service daemon did not answer on /health" });
    await expect(runSetup(h.deps)).rejects.toThrow("did not answer on /health");
    expect(h.calls).not.toContain("pair");
    expect(h.out.join("\n")).toContain("flightdeckd doctor");
  });

  test("running from source skips the binary copy and says so", async () => {
    const h = harness();
    h.deps.installBinary = () => false;
    await runSetup(h.deps);
    expect(h.out.join("\n")).toContain("Running from source");
  });

  test("--yes takes the folders from the command line and asks nothing", async () => {
    const h = harness({ tailscale: "100.64.0.9" });
    const a = h.dir("a");
    const b = h.dir("b");
    h.asked.length = 0;
    await runSetup(h.deps, { yes: true, folders: [a, b] });
    expect(h.asked).toEqual([]);
    expect(loadConfig(h.configFile).allowedRoots).toEqual([a, b]);
    expect(loadConfig(h.configFile).bind).toBe("127.0.0.1");
    expect(h.calls).toEqual(["binary", "hooks", "service", "pair"]);
  });

  test("--yes refuses a folder that does not exist, and no folder at all, before changing anything", async () => {
    const h = harness();
    await expect(
      runSetup(h.deps, { yes: true, folders: [join(h.home, "missing")] }),
    ).rejects.toThrow("is not a folder that exists");
    await expect(runSetup(h.deps, { yes: true, folders: [] })).rejects.toThrow("pass --folders");
    expect(h.calls).toEqual([]);
  });

  test("--yes keeps the folders already in the config when none is given", async () => {
    const h = harness({ config: { token: "t".repeat(32), allowedRoots: ["/srv/old"] } });
    await runSetup(h.deps, { yes: true, folders: [] });
    expect(loadConfig(h.configFile).allowedRoots).toEqual(["/srv/old"]);
  });
});

describe("prompt", () => {
  async function* lines(...items: string[]) {
    for (const item of items) yield item;
  }

  test("asks, confirms with a default on an empty answer, and asks again on an unclear one", async () => {
    const written: string[] = [];
    const prompt = createPrompt(lines("hello", "", "n", "maybe", "y"), (s) => written.push(s));
    expect(await prompt.ask("name? ")).toBe("hello");
    expect(await prompt.confirm("ok?", true)).toBe(true);
    expect(await prompt.confirm("ok?", true)).toBe(false);
    expect(await prompt.confirm("ok?", false)).toBe(true);
    expect(written.join("")).toContain("name? ");
    expect(written.join("")).toContain("[Y/n]");
    expect(written.join("")).toContain("Please answer y or n");
  });

  test("input that ends fails with a clear message instead of answering nothing forever", async () => {
    const prompt = createPrompt(lines(), () => {});
    await expect(prompt.ask("name? ")).rejects.toThrow("input closed");
    await expect(prompt.confirm("ok?", true)).rejects.toThrow("--yes --folders");
  });
});

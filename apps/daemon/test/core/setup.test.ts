import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.ts";
import { stableBinPath } from "../../src/service/domain/version.ts";
import {
  createPrompt,
  installStableBinary,
  reconcileStableBinary,
  runSetup,
  type SetupDeps,
} from "../../src/service/setup.ts";
import {
  defaultHostName,
  detectWsl,
  readProcVersion,
  realWslProbe,
  WSL_PORT_OFFSET,
  type WslProbe,
} from "../../src/wsl/index.ts";
import { tempDir } from "../support/helpers.ts";

const TAILSCALE_NETWORKS = ["100.64.0.0/10", "fd7a:115c:a1e0::/48"];

/** The `allowedRoots` as written in the file: `loadConfig` resolves them to native paths. */
const storedRoots = (file: string) =>
  (JSON.parse(readFileSync(file, "utf8")) as { allowedRoots: string[] }).allowedRoots;
const forward = (path: string) => path.replaceAll("\\", "/");

function harness(
  options: {
    answers?: string[];
    confirms?: Record<string, boolean>;
    tailscale?: string | null;
    config?: object;
    serviceError?: string;
    /** The platform the wizard thinks it runs on, with a home of that platform. */
    platform?: NodeJS.Platform;
    home?: string;
  } = {},
) {
  const home = options.home ?? tempDir("fd-setup-home-");
  const configFile = join(tempDir("fd-setup-"), "config.json");
  if (options.config) writeFileSync(configFile, JSON.stringify(options.config));
  const defaults = new Map<string, boolean>();
  const calls: string[] = [];
  /** What had already run when the PATH step ran, one entry per run. */
  const pathAt: string[][] = [];
  const asked: string[] = [];
  const out: string[] = [];
  const deps: SetupDeps = {
    ask: async (question) => {
      asked.push(question);
      return answers.shift() ?? "";
    },
    confirm: async (question, fallback) => {
      asked.push(question);
      defaults.set(question.includes("Tailscale") ? "Tailscale" : question, fallback);
      for (const [needle, answer] of Object.entries(options.confirms ?? {})) {
        if (question.includes(needle)) return answer;
      }
      return fallback;
    },
    log: { log: (m) => out.push(m), error: (m) => out.push(m) },
    configFile,
    home,
    platform: options.platform ?? process.platform,
    isDirectory: (path) =>
      path.toLowerCase().startsWith(home.toLowerCase()) && !path.endsWith("missing"),
    tailscaleIp: async () => options.tailscale ?? null,
    installBinary: async () => {
      calls.push("binary");
      return true;
    },
    addToPath: async () => {
      pathAt.push([...calls]);
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
  // A home given by the test is another platform's path: on this disk it is only a name (a
  // `mkdir` of `C:\\Users\\dev` would leave a folder with that name here), and `isDirectory` is faked.
  const dir = (name: string) => {
    const path = join(home, name);
    if (options.home === undefined) mkdirSync(path, { recursive: true });
    return path;
  };
  // Unless a test says otherwise, the user gives one folder and then finishes.
  const answers = [...(options.answers ?? [dir("code"), ""])];
  return { deps, home, configFile, calls, pathAt, asked, defaults, out, dir };
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
    expect((await loadConfig(h.configFile)).allowedRoots).toEqual([a, b]);
  });

  test("a Linux host whose linger is off ends with a loud warning and the command, after the pairing link", async () => {
    const h = harness();
    h.deps.linger = async () => "off";
    await runSetup(h.deps);
    const warning = h.out.findIndex((line) => line.includes("sudo loginctl enable-linger $USER"));
    expect(warning).toBeGreaterThan(-1);
    expect(h.out.join("\n")).toContain("WARNING");
    expect(h.out.join("\n")).toContain("after a reboot");
    // Last thing printed: nobody scrolls past it.
    expect(h.out.slice(warning).some((line) => line.includes("pair"))).toBe(false);
    expect(h.calls.at(-1)).toBe("pair");
  });

  test("with linger on, or where it does not apply, setup says nothing about it", async () => {
    for (const state of ["on", null] as const) {
      const h = harness();
      h.deps.linger = async () => state;
      await runSetup(h.deps);
      expect(h.out.join("\n")).not.toContain("linger");
    }
    const none = harness();
    await runSetup(none.deps);
    expect(none.out.join("\n")).not.toContain("linger");
  });

  test("the PATH step runs right after the binary is placed, and not when running from source", async () => {
    const h = harness();
    await runSetup(h.deps);
    expect(h.pathAt).toEqual([["binary"]]);
    const source = harness();
    source.deps.installBinary = async () => false;
    await runSetup(source.deps);
    expect(source.pathAt).toEqual([]);
  });

  test("a folder that does not exist is refused with the reason and asked again", async () => {
    const h = harness();
    const good = h.dir("code");
    const answers = [join(h.home, "missing"), good, ""];
    h.deps.ask = async () => answers.shift() ?? "";
    await runSetup(h.deps);
    expect(h.out.join("\n")).toContain("is not a folder that exists");
    expect((await loadConfig(h.configFile)).allowedRoots).toEqual([good]);
  });

  test("~ in a folder answer means the home, and folders already in the config stay", async () => {
    const h = harness({ config: { token: "t".repeat(32), allowedRoots: ["/srv/old"] } });
    h.dir("code");
    const answers = ["~/code", ""];
    h.deps.ask = async () => answers.shift() ?? "";
    await runSetup(h.deps);
    // What the file keeps is what the user wrote, plus the new folder with forward slashes.
    expect(storedRoots(h.configFile)).toEqual(["/srv/old", forward(join(h.home, "code"))]);
    expect(h.out.join("\n")).toContain("/srv/old");
  });

  test("with no folder at all it asks again until one is given or the user insists", async () => {
    const h = harness({ confirms: { "without project folders": false } });
    const good = h.dir("code");
    const answers = ["", good, ""];
    h.deps.ask = async () => answers.shift() ?? "";
    await runSetup(h.deps);
    expect((await loadConfig(h.configFile)).allowedRoots).toEqual([good]);
    const insist = harness({
      answers: [""],
      confirms: { "without project folders": true, hooks: false },
    });
    await runSetup(insist.deps);
    expect((await loadConfig(insist.configFile)).allowedRoots).toEqual([]);
    expect(insist.calls).toEqual(["binary", "service", "pair"]);
  });

  test("with Tailscale, saying yes listens on the Tailscale address only, never on every interface", async () => {
    const h = harness({ tailscale: "100.64.0.9", confirms: { Tailscale: true } });
    const good = h.dir("code");
    const answers = [good, ""];
    h.deps.ask = async () => answers.shift() ?? "";
    await runSetup(h.deps);
    const config = await loadConfig(h.configFile);
    expect(config.bind).toBe("100.64.0.9");
    expect(config.allowedNetworks).toEqual(["127.0.0.0/8", "::1/128", ...TAILSCALE_NETWORKS]);
  });

  test("with Tailscale, saying no keeps the daemon on the loopback; without Tailscale it never asks", async () => {
    const no = harness({ tailscale: "100.64.0.9", confirms: { Tailscale: false } });
    no.dir("code");
    await runSetup(no.deps);
    expect((await loadConfig(no.configFile)).bind).toBe("127.0.0.1");
    expect(no.asked.find((q) => q.includes("Tailscale"))).toBeDefined();
    expect(no.defaults.get("Tailscale")).toBe(false);
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
    h.deps.installBinary = async () => false;
    await runSetup(h.deps);
    expect(h.out.join("\n")).toContain("Running from source");
  });

  test("on Windows a folder is stored with forward slashes, like the manual's example, and the ones already there stay as written", async () => {
    const h = harness({
      platform: "win32",
      home: "C:\\Users\\dev",
      config: { token: "t".repeat(32), allowedRoots: ["D:/old/Projects"] },
      answers: ["C:\\Users\\dev\\code", "~\\work", "d:\\OLD\\projects", ""],
    });
    await runSetup(h.deps);
    // The third answer is the folder already there, in other letters: no duplicate.
    expect(storedRoots(h.configFile)).toEqual([
      "D:/old/Projects",
      "C:/Users/dev/code",
      "C:/Users/dev/work",
    ]);
  });

  test("on Windows --yes takes folders typed with either slash", async () => {
    const h = harness({ platform: "win32", home: "C:\\Users\\dev" });
    await runSetup(h.deps, { yes: true, folders: ["C:/Users/dev/a", "C:\\Users\\dev\\b"] });
    expect(storedRoots(h.configFile)).toEqual(["C:/Users/dev/a", "C:/Users/dev/b"]);
  });

  test("on Linux a folder keeps its path as it is", async () => {
    const h = harness({
      platform: "linux",
      home: "/home/dev",
      answers: ["~/code", "/home/dev/lib", ""],
    });
    await runSetup(h.deps);
    expect(storedRoots(h.configFile)).toEqual(["/home/dev/code", "/home/dev/lib"]);
  });

  test("--yes takes the folders from the command line and asks nothing", async () => {
    const h = harness({ tailscale: "100.64.0.9" });
    const a = h.dir("a");
    const b = h.dir("b");
    h.asked.length = 0;
    await runSetup(h.deps, { yes: true, folders: [a, b] });
    expect(h.asked).toEqual([]);
    expect((await loadConfig(h.configFile)).allowedRoots).toEqual([a, b]);
    expect((await loadConfig(h.configFile)).bind).toBe("127.0.0.1");
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
    expect(storedRoots(h.configFile)).toEqual(["/srv/old"]);
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

describe("reconcileStableBinary", () => {
  function files(stableVersion: string | null) {
    const dir = tempDir("fd-reconcile-");
    const self = join(dir, "download");
    const stable = join(dir, "stable");
    writeFileSync(self, "new");
    writeFileSync(stable, "old");
    const seen: string[] = [];
    const options = {
      self,
      stable,
      selfVersion: "0.31.0",
      stableVersion: async () => stableVersion,
      stopService: async () => {
        seen.push(readFileSync(stable, "utf8"));
      },
    };
    return { options, stable, seen };
  }

  test("an older version is replaced after the service stopped, the old file kept as .old", async () => {
    const h = files("0.29.0");
    expect(await reconcileStableBinary(h.options)).toEqual({
      outcome: "replaced",
      stableVersion: "0.29.0",
    });
    expect(h.seen).toEqual(["old"]);
    expect(readFileSync(h.stable, "utf8")).toBe("new");
    expect(readFileSync(`${h.stable}.old`, "utf8")).toBe("old");
  });

  test("versions compare as numbers: 0.9.0 is older than 0.31.0", async () => {
    const h = files("0.9.0");
    expect((await reconcileStableBinary(h.options)).outcome).toBe("replaced");
  });

  test("a binary that does not answer is replaced", async () => {
    const h = files(null);
    expect(await reconcileStableBinary(h.options)).toEqual({
      outcome: "replaced",
      stableVersion: null,
    });
  });

  test("the same version and a newer one are left alone and the service is not stopped", async () => {
    for (const [version, outcome] of [
      ["0.31.0", "same"],
      ["0.40.0", "newer"],
    ] as const) {
      const h = files(version);
      expect(await reconcileStableBinary(h.options)).toEqual({ outcome, stableVersion: version });
      expect(h.seen).toEqual([]);
      expect(readFileSync(h.stable, "utf8")).toBe("old");
    }
  });
});

describe("stable binary", () => {
  const platform = "linux";

  test("running from source leaves everything alone", async () => {
    const home = tempDir("fd-stable-");
    const stable = stableBinPath(home, platform);
    expect(await installStableBinary(["/usr/bin/bun", "run", "main.ts"], stable, platform)).toBe(
      "source",
    );
    expect(existsSync(stable)).toBe(false);
  });

  test("a binary that is already at the stable place stays", async () => {
    const home = tempDir("fd-stable-");
    const stable = stableBinPath(home, platform);
    mkdirSync(join(home, ".flightdeck", "bin"), { recursive: true });
    writeFileSync(stable, "daemon");
    expect(await installStableBinary([stable], stable, platform)).toBe("already");
    expect(readFileSync(stable, "utf8")).toBe("daemon");
  });

  test("a stable binary that exists is kept: replacing it is what update does", async () => {
    const home = tempDir("fd-stable-");
    const stable = stableBinPath(home, platform);
    mkdirSync(join(home, ".flightdeck", "bin"), { recursive: true });
    writeFileSync(stable, "installed");
    const other = join(home, "download", "flightdeckd");
    mkdirSync(join(home, "download"));
    writeFileSync(other, "downloaded");
    expect(await installStableBinary([other], stable, platform)).toBe("kept");
    expect(readFileSync(stable, "utf8")).toBe("installed");
  });

  test("the running binary is copied to ~/.flightdeck/bin, executable", async () => {
    const home = tempDir("fd-stable-");
    const stable = stableBinPath(home, platform);
    const other = join(home, "flightdeckd");
    writeFileSync(other, "downloaded");
    const copying = installStableBinary([other], stable, platform);
    expect(copying).toBeInstanceOf(Promise);
    expect(await copying).toBe("copied");
    expect(readFileSync(stable, "utf8")).toBe("downloaded");
    // Windows has no executable bit: the file runs because of its .exe name.
    if (process.platform !== "win32") expect(statSync(stable).mode & 0o111).not.toBe(0);
  });
});

describe("setup: nothing outside its temporary folders", () => {
  // Runs after the tests above: a Windows home like `C:\\Users\\dev` is a plain relative name on
  // Linux, so a `mkdir` of it would leave a folder with that name in the working directory.
  test("no test of this file left a folder named like a Windows path in the working directory", () => {
    const stray = readdirSync(process.cwd()).filter((name) => /^[A-Za-z]:/.test(name));
    expect(stray).toEqual([]);
  });

  test("a harness on another platform's home creates nothing on the real disk", () => {
    harness({ platform: "win32", home: "C:\\Users\\dev" });
    expect(existsSync(join(process.cwd(), "C:\\Users\\dev"))).toBe(false);
  });
});

describe("setup: WSL host", () => {
  const probe = (env: Record<string, string>, version: string | null = null): WslProbe => ({
    env,
    procVersion: () => version,
  });
  const ports = (file: string) => {
    const raw = JSON.parse(readFileSync(file, "utf8")) as {
      port: number;
      hooks: { port: number };
      telemetry: { port?: number };
    };
    return [raw.port, raw.hooks.port, raw.telemetry.port];
  };

  test("WSL is told by WSL_DISTRO_NAME first, then by /proc/version", () => {
    expect(detectWsl(probe({ WSL_DISTRO_NAME: "Ubuntu" }, "Linux (microsoft)"))).toEqual({
      distro: "Ubuntu",
    });
    expect(detectWsl(probe({}, "Linux version 5.15.0-microsoft-standard-WSL2"))).toEqual({
      distro: null,
    });
    expect(detectWsl(probe({}, "Linux version 6.1.0 (Debian)"))).toBeNull();
    expect(detectWsl(probe({}, null))).toBeNull();
    expect(detectWsl(probe({ WSL_DISTRO_NAME: "" }, null))).toBeNull();
  });

  test("the default host name adds the distro inside WSL and is the machine's elsewhere", () => {
    const machine = hostname();
    expect(defaultHostName(probe({ WSL_DISTRO_NAME: "Ubuntu" }))).toBe(`${machine} (WSL Ubuntu)`);
    expect(defaultHostName(probe({}, "microsoft"))).toBe(`${machine} (WSL)`);
    expect(defaultHostName(probe({}, null))).toBe(machine);
  });

  test("a new config takes the WSL host name, and the real probe reads the process", async () => {
    const before = process.env.WSL_DISTRO_NAME;
    process.env.WSL_DISTRO_NAME = "Debian";
    try {
      const file = join(tempDir("fd-wsl-"), "config.json");
      expect((await loadConfig(file)).hostName).toBe(`${hostname()} (WSL Debian)`);
    } finally {
      if (before === undefined) delete process.env.WSL_DISTRO_NAME;
      else process.env.WSL_DISTRO_NAME = before;
    }
  });

  test("/proc/version is read as text, and null when it cannot be read", () => {
    expect(readProcVersion((path) => `read ${path}`)).toBe("read /proc/version");
    expect(
      readProcVersion(() => {
        throw new Error("ENOENT");
      }),
    ).toBeNull();
    expect(["string", "object"]).toContain(typeof realWslProbe.procVersion());
  });

  test("setup in WSL moves the ports off the Windows daemon's 7420, 7421 and 7422", async () => {
    const h = harness();
    h.deps.wsl = { distro: "Ubuntu" };
    await runSetup(h.deps);
    expect(ports(h.configFile)).toEqual([7420 + WSL_PORT_OFFSET, 7421 + WSL_PORT_OFFSET, 7432]);
    expect((await loadConfig(h.configFile)).hooks.port).toBe(7431);
  });

  test("a port the person chose stays, and a second run changes nothing", async () => {
    const h = harness({ config: { port: 9000, hooks: { port: 7421 } } });
    h.deps.wsl = { distro: null };
    await runSetup(h.deps);
    expect(ports(h.configFile)).toEqual([9000, 7431, 7432]);
    const first = readFileSync(h.configFile, "utf8");
    await runSetup(h.deps);
    expect(readFileSync(h.configFile, "utf8")).toBe(first);
  });

  test("outside WSL the ports stay", async () => {
    const h = harness();
    await runSetup(h.deps);
    expect(ports(h.configFile)).toEqual([7420, 7421, undefined]);
  });
});

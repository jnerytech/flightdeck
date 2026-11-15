import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../../src/config.ts";
import { acquireLock } from "../../src/kernel/lock.ts";
import { DAEMON_VERSION } from "../../src/kernel/version.ts";
import { type CliDeps, runCli } from "../../src/main.ts";
import { tempDir } from "../support/helpers.ts";

describe("setup command", () => {
  function cliHarness(
    stdin?: (dir: string) => string,
    options: {
      selfCommand?: (dir: string) => string[];
      installed?: boolean;
      /** The platform the service context fakes; the wizard keeps the host's own paths. */
      platform?: "linux" | "win32";
      /** What `reg query` answers for the user's Path, on a Windows context. */
      userPath?: (dir: string) => string;
    } = {},
  ) {
    const out: string[] = [];
    const exits: number[] = [];
    const written = new Map<string, string>();
    const calls: string[][] = [];
    const daemon = Bun.serve({ port: 0, fetch: () => Response.json({ ok: true }) });
    const dir = tempDir("fd-setup-cli-");
    const file = join(dir, "config.json");
    writeFileSync(file, JSON.stringify({ token: "t".repeat(32), dataDir: dir, port: daemon.port }));
    const deps: CliDeps = {
      env: {},
      log: { log: (m) => out.push(m), error: (m) => out.push(m) },
      exit: (code) => exits.push(code),
      // #996: the questions go here, never to the run's own stdout.
      stdout: (text) => out.push(text),
      onSignal: () => {},
      exec: async () => ({ code: 1, stdout: "" }),
      ...(options.selfCommand ? { selfCommand: options.selfCommand(dir) } : {}),
      serviceHealthTimeoutMs: 2_000,
      serviceContext: (dryRun) => ({
        platform: options.platform ?? "linux",
        home: dir,
        user: "dev",
        command: ["/home/dev/.local/bin/flightdeckd"],
        systemRoot: "C:\\Windows",
        tempDir: options.platform === "win32" ? "C:\\Temp" : "/tmp",
        dryRun,
        exec: async (cmd) => {
          calls.push(cmd);
          if (cmd[0] === "loginctl") return { code: 0, stdout: "Linger=yes\n" };
          if (cmd[0] === "reg" && cmd[1] === "query") {
            return options.userPath === undefined
              ? { code: 1, stdout: "" }
              : { code: 0, stdout: `    Path    REG_EXPAND_SZ    ${options.userPath(dir)}\r\n` };
          }
          if (cmd.includes("cat") && options.installed) {
            return { code: 0, stdout: "ExecStart=/old/flightdeckd start\n" };
          }
          return { code: 0, stdout: "" };
        },
        writeFile: (path, content) => {
          written.set(path, content);
        },
        removeFile: () => {},
        which: () => null,
      }),
      ...(stdin
        ? {
            stdin: new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode(stdin(dir)));
                controller.close();
              },
            }),
          }
        : {}),
    };
    return { deps, out, exits, written, calls, file, dir, stop: () => daemon.stop(true) };
  }

  test("--yes sets everything up: folders, service started, pair link printed", async () => {
    const h = cliHarness();
    const project = join(h.dir, "project");
    mkdirSync(project);
    await runCli(["setup", "--yes", "--folders", project, "--config", h.file], h.deps);
    await h.stop();
    expect(h.exits).toEqual([0]);
    expect((await loadConfig(h.file)).allowedRoots).toEqual([project]);
    expect(h.written.has(`${h.dir}/.config/systemd/user/flightdeckd.service`)).toBe(true);
    expect(h.out.join("\n")).toContain("the service's daemon is answering");
    expect(h.out.join("\n")).toContain("flightdeck://127.0.0.1:");
  });

  test("a Windows service context on another host's paths: the wizard keeps reading the host's real folders, and the service is the scheduled task", async () => {
    const h = cliHarness(undefined, { platform: "win32" });
    const project = join(h.dir, "project");
    mkdirSync(project);
    await runCli(["setup", "--yes", "--folders", project, "--config", h.file], h.deps);
    await h.stop();
    expect(h.exits).toEqual([0]);
    expect((await loadConfig(h.file)).allowedRoots).toEqual([project]);
    expect(h.written.has("C:\\Temp\\flightdeckd-task.xml")).toBe(true);
    const schtasks = h.calls.filter((c) => c[0] === "schtasks").map((c) => c[1]);
    expect(schtasks).toEqual(["/Query", "/Create", "/Run"]);
  });

  test("a compiled binary is copied to ~/.flightdeck/bin and the service runs that copy", async () => {
    const h = cliHarness(undefined, {
      selfCommand: (dir) => [join(dir, "download", "flightdeckd")],
    });
    mkdirSync(join(h.dir, "download"));
    writeFileSync(join(h.dir, "download", "flightdeckd"), "binary");
    const project = join(h.dir, "project");
    mkdirSync(project);
    await runCli(["setup", "--yes", "--folders", project, "--config", h.file], h.deps);
    await h.stop();
    const stable = join(h.dir, ".flightdeck", "bin", "flightdeckd");
    expect(h.exits).toEqual([0]);
    expect(readFileSync(stable, "utf8")).toBe("binary");
    const unit = h.written.get(`${h.dir}/.config/systemd/user/flightdeckd.service`) ?? "";
    // systemd quotes a path with backslashes (a Windows host faking Linux) and doubles them.
    expect(unit.replaceAll("\\\\", "\\")).toContain(stable);
  });

  /** A download and a stable binary already installed, with the version each one answers. */
  async function upgrade(
    stableVersion: string | null | "real",
    installed = false,
    holdLock = false,
  ) {
    const h = cliHarness(undefined, {
      installed,
      selfCommand: (dir) => [join(dir, "download", "flightdeckd")],
    });
    // "real" leaves the probe alone: it runs the stable file, which is not a flightdeckd.
    if (stableVersion !== "real") h.deps.binaryVersion = async () => stableVersion;
    if (holdLock) h.deps.serviceStopTimeoutMs = 50;
    const lock = holdLock ? await acquireLock(h.dir) : null;
    mkdirSync(join(h.dir, "download"));
    writeFileSync(join(h.dir, "download", "flightdeckd"), "new");
    mkdirSync(join(h.dir, ".flightdeck", "bin"), { recursive: true });
    const stable = join(h.dir, ".flightdeck", "bin", "flightdeckd");
    writeFileSync(stable, "installed");
    const project = join(h.dir, "project");
    mkdirSync(project);
    await runCli(["setup", "--yes", "--folders", project, "--config", h.file], h.deps);
    await h.stop();
    await lock?.release();
    return { ...h, stable, text: h.out.join("\n") };
  }

  test("an older stable binary is replaced by the download, the old one kept, and the wizard says which binary the service runs", async () => {
    const h = await upgrade("0.1.0");
    expect(h.exits).toEqual([0]);
    expect(readFileSync(h.stable, "utf8")).toBe("new");
    expect(readFileSync(`${h.stable}.old`, "utf8")).toBe("installed");
    expect(h.text).toContain("replaced");
    expect(h.text).toContain(`will run ${h.stable} (flightdeckd ${DAEMON_VERSION})`);
  });

  test("a stable binary that does not answer --version counts as older", async () => {
    const h = await upgrade(null);
    expect(readFileSync(h.stable, "utf8")).toBe("new");
    expect(h.text).toContain("unknown version");
  });

  test("the real probe runs the stable file: one that is not a flightdeckd is replaced", async () => {
    const h = await upgrade("real");
    expect(readFileSync(h.stable, "utf8")).toBe("new");
  });

  test("a daemon that will not stop leaves the stable binary alone and fails with the way out", async () => {
    const h = await upgrade("0.1.0", true, true);
    expect(h.exits).toEqual([1]);
    expect(readFileSync(h.stable, "utf8")).toBe("installed");
    expect(h.text).toContain("stop it and run setup again");
  });

  test("the same version stays and the wizard says so", async () => {
    const h = await upgrade(DAEMON_VERSION);
    expect(readFileSync(h.stable, "utf8")).toBe("installed");
    expect(h.text).toContain("already version");
    expect(h.text).toContain(`will run ${h.stable} (flightdeckd ${DAEMON_VERSION})`);
  });

  test("a newer stable binary stays and the wizard says it is newer than the download", async () => {
    const h = await upgrade("99.0.0");
    expect(readFileSync(h.stable, "utf8")).toBe("installed");
    expect(h.text).toContain("newer than this download");
    expect(h.text).toContain(`will run ${h.stable} (flightdeckd 99.0.0)`);
  });

  test("replacing the stable binary stops an installed service first", async () => {
    const h = await upgrade("0.1.0", true);
    const names = h.calls.map((c) => c.slice(0, 3).join(" "));
    expect(names.indexOf("systemctl --user stop")).toBeGreaterThan(-1);
    expect(readFileSync(h.stable, "utf8")).toBe("new");
  });

  test("a service that is already installed is stopped before it is installed again", async () => {
    const h = cliHarness(undefined, { installed: true });
    const project = join(h.dir, "project");
    mkdirSync(project);
    await runCli(["setup", "--yes", "--folders", project, "--config", h.file], h.deps);
    await h.stop();
    expect(h.exits).toEqual([0]);
    const names = h.calls.map((c) => c.slice(0, 3).join(" "));
    expect(names.indexOf("systemctl --user stop")).toBeGreaterThan(-1);
  });

  test("interactive: reads the answers from the input", async () => {
    const h = cliHarness((dir) => `${join(dir, "project")}\n\nn\n`);
    mkdirSync(join(h.dir, "project"));
    await runCli(["setup", "--config", h.file], h.deps);
    await h.stop();
    expect(h.exits).toEqual([0]);
    expect((await loadConfig(h.file)).allowedRoots).toEqual([join(h.dir, "project")]);
    const asked = h.out.filter((line) => line.startsWith("Project folder Flightdeck may start"));
    expect(asked).toHaveLength(2);
    expect(h.out.some((line) => line.startsWith("Install the Claude Code hooks"))).toBe(true);
  });

  test("input that ends exits 1 with the way out", async () => {
    const h = cliHarness(() => "");
    await runCli(["setup", "--config", h.file], h.deps);
    await h.stop();
    expect(h.exits).toEqual([1]);
    expect(h.out.join("\n")).toContain("--yes --folders");
    expect(h.out).toContain(
      "Project folder Flightdeck may start sessions in (empty answer to finish): ",
    );
  });

  test("in WSL the ports the person did not choose are shifted, and written to config.json", async () => {
    const h = cliHarness();
    h.deps.env = { WSL_DISTRO_NAME: "Ubuntu" };
    const read = () =>
      JSON.parse(readFileSync(h.file, "utf8")) as {
        port: number;
        hooks: { port: number };
        telemetry: { port?: number };
      };
    const chosen = read().port;
    const project = join(h.dir, "project");
    mkdirSync(project);
    await runCli(["setup", "--yes", "--folders", project, "--config", h.file], h.deps);
    await h.stop();
    expect(read().port).toBe(chosen);
    expect(read().hooks.port).toBe(7431);
    expect(read().telemetry.port).toBe(7432);
  });
});

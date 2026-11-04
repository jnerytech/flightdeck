/** Coverage of the daemon's wiring: the closures `startDaemon` and the CLI hand to the services. */
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as protocol from "@flightdeck/protocol";
import { installFakeCli } from "../../../scripts/test/fake-cli.ts";
import { type CliDeps, runCli, startDaemon } from "../src/main.ts";
import { git } from "./board-helpers.ts";
import { poll, tempDir } from "./helpers.ts";
import { writeTranscript } from "./history-helpers.ts";

setDefaultTimeout(30_000);

const TOKEN = "cobertura-main-token-0123456789";
const stops: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const stop of stops.splice(0).reverse()) await stop();
});

async function ask(url: string, type: string, payload: object) {
  const ws = new WebSocket(url);
  const acks: protocol.Ack[] = [];
  ws.addEventListener("message", (m) => {
    const msg = protocol.parseServerMessage(String(m.data));
    if (msg.type === "ack") acks.push(msg);
  });
  await new Promise((r) => ws.addEventListener("open", r));
  ws.send(JSON.stringify({ id: "1", type: "hello", payload: { token: TOKEN, client: "t" } }));
  ws.send(JSON.stringify({ id: "2", type, payload }));
  const ack = await poll(() => acks.find((a) => a.id === "2"), 8000);
  ws.close();
  return ack;
}

function config(dir: string, extra: object = {}): string {
  const file = join(dir, "config.json");
  writeFileSync(
    file,
    JSON.stringify({
      hostName: "h",
      port: 0,
      token: TOKEN,
      dataDir: join(dir, "data"),
      allowedRoots: [dir],
      ...extra,
    }),
  );
  return file;
}

describe("cobertura-main-0330: the running daemon", () => {
  test("the GitHub wiring: a linked board is polled on the host's timers, and a session starts from a repo", async () => {
    const dir = tempDir("fd-cob-main-gh-");
    const ok = (data: unknown) => ({ stdout: JSON.stringify({ data }) });
    const gh = installFakeCli("gh", [
      {
        args: ["auth", "status"],
        stdout:
          "github.com\n  ✓ Logged in to github.com account octocat (keyring)\n  - Token scopes: 'repo', 'read:project'\n",
      },
      { args: ["api", "user"], stdout: "octocat\n" },
      {
        args: ["api", "graphql"],
        contains: ["field(name"],
        ...ok({ node: { field: { id: "F1", options: [{ id: "o1", name: "Todo" }] } } }),
      },
      {
        args: ["api", "graphql"],
        contains: ["items(first"],
        ...ok({
          viewer: { login: "octocat" },
          node: { items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } },
        }),
      },
      {
        args: ["api", "graphql"],
        contains: ["projectsV2(first"],
        ...ok({
          viewer: {
            login: "octocat",
            projectsV2: {
              nodes: [
                { id: "PVT_b", title: "Roadmap", number: 1, url: "u", owner: { login: "acme" } },
              ],
            },
            organizations: { nodes: [] },
          },
        }),
      },
    ]);
    stops.push(gh.restore);
    const app = join(dir, "app");
    mkdirSync(app);
    git(app, "init", "-q", "-b", "main");
    git(app, "config", "commit.gpgsign", "false");
    writeFileSync(join(app, "README.md"), "# app\n");
    git(app, "add", ".");
    git(app, "commit", "-q", "-m", "first");
    git(app, "remote", "add", "origin", "https://github.com/acme/app.git");
    const daemon = await startDaemon(
      { command: "start", config: config(dir), runtime: "fake" },
      { HOME: join(dir, "home"), USERPROFILE: join(dir, "home") },
      { log: () => {}, error: () => {} },
    );
    stops.push(() => daemon.stop());
    const started = await ask(daemon.url, "github.start", {
      repo: "acme/app",
      root: dir,
      mode: "session",
    });
    expect(started?.ok).toBe(true);
    const projectId = started?.ok ? (started.data as { projectId: string }).projectId : "";
    const linked = await ask(daemon.url, "boardsync.link", { projectId, boardId: "PVT_b" });
    expect(linked?.ok).toBe(true);
    expect((await ask(daemon.url, "boardsync.unlink", { projectId }))?.ok).toBe(true);
  });

  test("host.info points to the stable binary when it is installed, and history.list asks the host's project keys", async () => {
    const dir = tempDir("fd-cob-main-");
    const home = join(dir, "home");
    const stable = join(
      home,
      ".flightdeck",
      "bin",
      process.platform === "win32" ? "flightdeckd.exe" : "flightdeckd",
    );
    mkdirSync(join(home, ".flightdeck", "bin"), { recursive: true });
    writeFileSync(stable, "");
    const projects = join(home, ".claude", "projects");
    const cwd = join(dir, "work");
    writeTranscript(projects, "-work", "s1", [
      JSON.stringify({
        type: "user",
        uuid: "u1",
        timestamp: "2026-11-01T10:00:00.000Z",
        cwd,
        message: { role: "user", content: "hello there" },
      }),
    ]);
    const daemon = await startDaemon(
      {
        command: "start",
        config: config(dir, { history: { roots: [projects] } }),
        runtime: "fake",
      },
      { HOME: home, USERPROFILE: home },
      { log: () => {}, error: () => {} },
      { serviceInstalled: async () => true, linger: async () => null },
    );
    stops.push(() => daemon.stop());
    const info = await ask(daemon.url, "host.info", {});
    const path = info?.ok
      ? (info.data as { flightdeckdPath?: string | null }).flightdeckdPath
      : null;
    expect(path).toBe(stable);
    const listed = await poll(async () => {
      const ack = await ask(daemon.url, "history.list", { projectKey: `host:h:${cwd}` });
      const sessions = ack?.ok ? (ack.data as { sessions: unknown[] }).sessions : [];
      return sessions.length > 0 ? sessions : null;
    }, 15_000);
    expect(listed).toHaveLength(1);
  });

  test("doctor.run without an override asks the service controller through the preload's guard, never the real one", async () => {
    const dir = tempDir("fd-cob-main-doctor-");
    const guard = join(dir, "service-guard.log");
    const before = process.env.FLIGHTDECK_SERVICE_GUARD;
    process.env.FLIGHTDECK_SERVICE_GUARD = guard;
    stops.push(() => {
      if (before === undefined) delete process.env.FLIGHTDECK_SERVICE_GUARD;
      else process.env.FLIGHTDECK_SERVICE_GUARD = before;
    });
    const daemon = await startDaemon(
      { command: "start", config: config(dir), runtime: "fake" },
      {},
      { log: () => {}, error: () => {} },
    );
    stops.push(() => daemon.stop());
    const ack = await ask(daemon.url, "doctor.run", {});
    const result = (ack?.ok ? ack.data : null) as protocol.DoctorResult | null;
    expect(result?.checks.find((check) => check.id === "service")).toBeDefined();
  });
});

describe("cobertura-main-0330: the command line", () => {
  function deps(dir: string): { cli: CliDeps; out: string[]; exits: number[] } {
    const out: string[] = [];
    const exits: number[] = [];
    const cli: CliDeps = {
      env: {},
      log: { log: (m) => out.push(m), error: (m) => out.push(m) },
      exit: (code) => exits.push(code),
      onSignal: () => {},
      exec: async () => ({ code: 1, stdout: "" }),
      serviceContext: (dryRun) => ({
        platform: "linux",
        home: dir,
        user: "u",
        command: ["/h/flightdeckd"],
        systemRoot: "",
        tempDir: "/tmp",
        dryRun,
        exec: async () => ({ code: 1, stdout: "" }),
        writeFile: () => {},
        removeFile: () => {},
        which: () => null,
      }),
    };
    return { cli, out, exits };
  }

  test("doctor reports an allowed folder that is not there, and fails", async () => {
    const dir = tempDir("fd-cob-cli-doctor-");
    const missing = join(dir, "missing");
    const file = config(dir, { allowedRoots: [missing] });
    const { cli, out, exits } = deps(dir);
    await runCli(["doctor", "--config", file], cli);
    expect(out.join("\n")).toMatch(/FAIL\s+project folders/);
    expect(exits).toEqual([1]);
  });

  test("setup refuses a folder that is not there", async () => {
    const dir = tempDir("fd-cob-cli-setup-");
    const file = config(dir, { allowedRoots: [] });
    const { cli, out, exits } = deps(dir);
    await runCli(["setup", "--yes", "--folders", join(dir, "missing"), "--config", file], cli);
    expect(exits.some((code) => code !== 0)).toBe(true);
    expect(out.join("\n").length).toBeGreaterThan(0);
  });
});

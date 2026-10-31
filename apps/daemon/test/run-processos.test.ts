import { describe, expect, test } from "bun:test";
import { killTree, terminalRunHost } from "../src/runenv/host.ts";
import { TerminalManager } from "../src/terminal/terminal-manager.ts";
import { poll, workspace } from "./helpers.ts";
import { fakePtys } from "./pty-helpers.ts";

function realm() {
  const { root, project } = workspace();
  const ptys = fakePtys();
  const manager = new TerminalManager({
    pty: ptys.factory,
    allowedRoots: [root],
    platform: "linux",
    env: () => ({ PATH: "/bin", ANTHROPIC_API_KEY: "sk-secreta" }),
  });
  const treeKilled: number[] = [];
  const host = terminalRunHost(manager, { treeKill: (pid) => treeKilled.push(pid) });
  return { manager, ptys, host, project, root, treeKilled };
}

describe("run-processos: cada processo é uma aba do terminal do host", () => {
  test("abre o argv sem shell na worktree, com o ambiente do Run, e devolve a aba", () => {
    const r = realm();
    const started = r.host.spawn({
      argv: ["serve", "--port", "41000"],
      cwd: r.project,
      env: { FLIGHTDECK_PORT_WEB: "41000" },
    });
    const [pty] = r.ptys.spawned;
    expect(pty?.argv).toEqual(["serve", "--port", "41000"]);
    expect(pty?.cwd).toBe(r.project);
    expect(pty?.env.FLIGHTDECK_PORT_WEB).toBe("41000");
    // The same environment every terminal gets: the API key stays out.
    expect(pty?.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(r.manager.list().map((t) => t.terminalId)).toEqual([started.terminalId]);
  });

  test("exited traz o código de saída do processo", async () => {
    const r = realm();
    const started = r.host.spawn({ argv: ["serve"], cwd: r.project, env: {} });
    r.ptys.spawned[0]?.exit(7);
    expect(await started.exited).toBe(7);
  });

  test("um cwd fora das pastas permitidas é recusado pelo terminal, como em qualquer aba", () => {
    const r = realm();
    expect(() => r.host.spawn({ argv: ["serve"], cwd: "/etc", env: {} })).toThrow();
    expect(r.ptys.spawned).toHaveLength(0);
  });
});

describe("run-processos: o Stop encerra a árvore", () => {
  test("a árvore cai primeiro, e o terminal é encerrado: o filho que ignora SIGHUP e SIGTERM não escapa", async () => {
    const r = realm();
    const started = r.host.spawn({ argv: ["serve"], cwd: r.project, env: {} });
    const pty = r.ptys.spawned[0];
    r.host.kill(started.terminalId);
    expect(r.treeKilled).toEqual([pty?.pid ?? -1]);
    expect(pty?.killed).toBe(true);
    expect(await started.exited).toBe(143);
  });

  test("matar uma aba que já acabou, ou que não existe, não derruba nada", async () => {
    const r = realm();
    const started = r.host.spawn({ argv: ["serve"], cwd: r.project, env: {} });
    r.ptys.spawned[0]?.exit(0);
    await started.exited;
    r.host.kill(started.terminalId);
    r.host.kill("nenhuma");
    expect(r.treeKilled).toEqual([]);
  });

  test("o gerenciador diz o pid de um terminal vivo, e nada de um que acabou ou não existe", async () => {
    const r = realm();
    const started = r.host.spawn({ argv: ["serve"], cwd: r.project, env: {} });
    expect(r.manager.pidOf(started.terminalId)).toBe(r.ptys.spawned[0]?.pid ?? -1);
    expect(r.manager.pidOf("nenhuma")).toBeNull();
    r.ptys.spawned[0]?.exit(0);
    await started.exited;
    expect(r.manager.pidOf(started.terminalId)).toBeNull();
  });
});

describe("run-processos: killTree", () => {
  test("no Linux, mata o grupo de processos com SIGKILL, e um grupo que já acabou não é erro", () => {
    const signals: Array<[number, string]> = [];
    killTree(4321, {
      platform: "linux",
      signal: (pid, signal) => void signals.push([pid, signal]),
    });
    expect(signals).toEqual([[-4321, "SIGKILL"]]);
    expect(() =>
      killTree(4321, {
        platform: "linux",
        signal: () => {
          throw new Error("ESRCH");
        },
      }),
    ).not.toThrow();
  });

  test("no Windows, taskkill /T /F leva a árvore inteira, e uma falha dele não é erro", () => {
    const ran: string[][] = [];
    killTree(4321, { platform: "win32", run: (argv) => void ran.push(argv) });
    expect(ran).toEqual([["taskkill", "/PID", "4321", "/T", "/F"]]);
    expect(() =>
      killTree(4321, {
        platform: "win32",
        run: () => {
          throw new Error("sem taskkill");
        },
      }),
    ).not.toThrow();
  });

  test("de verdade: um processo e o filho dele, que ignoram SIGHUP e SIGTERM, somem com a árvore", async () => {
    const ignores =
      'process.on("SIGHUP",()=>{});process.on("SIGTERM",()=>{});setInterval(()=>{},1000)';
    const parentScript = `const c=Bun.spawn([process.execPath,"-e",${JSON.stringify(ignores)}]);console.log(c.pid);${ignores}`;
    const parent = Bun.spawn([process.execPath, "-e", parentScript], {
      stdout: "pipe",
      stderr: "ignore",
      // Its own process group (a session on Linux), like the leader of a PTY.
      detached: true,
    });
    const reader = parent.stdout.getReader();
    const first = await reader.read();
    const childPid = Number(new TextDecoder().decode(first.value).trim());
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    try {
      expect(alive(parent.pid)).toBe(true);
      expect(alive(childPid)).toBe(true);
      killTree(parent.pid);
      expect(await poll(() => !alive(parent.pid), 3000)).toBe(true);
      expect(await poll(() => !alive(childPid), 3000)).toBe(true);
    } finally {
      // Whatever the assertions said, nothing is left running.
      for (const pid of [childPid, parent.pid]) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Already gone.
        }
      }
    }
  });
});

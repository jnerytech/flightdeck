import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  listeningPorts,
  liveChildren,
  newResources,
  type ProcReader,
  type Resources,
} from "./leak-guard.ts";
import { realTempDir } from "./temp-dir.ts";

/** A /proc that holds the given files, links and directories. */
function fakeProc(
  pid: number,
  files: Record<string, string>,
  links: Record<string, string> = {},
): ProcReader {
  const names = (dir: string) => {
    const prefix = dir === "/" ? "/" : `${dir}/`;
    const all = [...Object.keys(files), ...Object.keys(links)];
    return [
      ...new Set(
        all
          .filter((path) => path.startsWith(prefix))
          .map((path) => path.slice(prefix.length).split("/")[0] ?? ""),
      ),
    ];
  };
  return {
    pid,
    list: names,
    read: (path) => files[path] ?? null,
    link: (path) => links[path] ?? null,
  };
}

const TCP_HEAD =
  "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode";
const row = (local: string, state: string, inode: number) =>
  `   0: ${local} 00000000:0000 ${state} 00000000:00000000 00:00000000 00000000  1000        0 ${inode} 1 0000000000000000 100 0 0 10 0`;

describe("leak-guard: the ports this process listens on", () => {
  test("a listening socket the process holds is a port; another process's socket, a connected one and a closed fd are not", () => {
    const proc = fakeProc(
      10,
      {
        "/proc/net/tcp": [
          TCP_HEAD,
          row("0100007F:1F90", "0A", 111),
          row("0100007F:1F91", "0A", 222),
          row("0100007F:1F92", "01", 111),
        ].join("\n"),
        "/proc/net/tcp6": [TCP_HEAD, row("00000000000000000000000001000000:0050", "0A", 333)].join(
          "\n",
        ),
      },
      {
        "/proc/self/fd/3": "socket:[111]",
        "/proc/self/fd/4": "/tmp/some-file",
        "/proc/self/fd/5": "socket:[333]",
      },
    );
    expect(listeningPorts(proc)).toEqual([80, 8080]);
  });

  test("with no TCP table it is empty", () => {
    expect(listeningPorts(fakeProc(10, {}))).toEqual([]);
  });
});

describe("leak-guard: the children this process has alive", () => {
  const stat = (pid: number, name: string, state: string, parent: number) =>
    `${pid} (${name}) ${state} ${parent} 1 1 0 -1`;

  test("a live child is listed with its command line; a zombie, a stranger's child and a non-numeric entry are not", () => {
    const proc = fakeProc(10, {
      "/proc/11/stat": stat(11, "git", "S", 10),
      "/proc/11/cmdline": "git\0worktree\0add\0/tmp/x\0",
      "/proc/12/stat": stat(12, "git", "Z", 10),
      "/proc/13/stat": stat(13, "sleep", "S", 99),
      "/proc/self/stat": stat(10, "bun", "R", 1),
    });
    expect(liveChildren(proc)).toEqual([{ pid: 11, cmd: "git worktree add /tmp/x" }]);
  });

  test("a name with spaces and a closing bracket does not hide the parent", () => {
    const proc = fakeProc(10, {
      "/proc/21/stat": stat(21, "tmux: server) x", "S", 10),
      "/proc/21/cmdline": "tmux\0",
    });
    expect(liveChildren(proc).map((child) => child.pid)).toEqual([21]);
  });

  test("a command line longer than eighty characters is cut", () => {
    const proc = fakeProc(10, {
      "/proc/31/stat": stat(31, "node", "S", 10),
      "/proc/31/cmdline": `node\0${"x".repeat(200)}`,
    });
    expect(liveChildren(proc)[0]?.cmd).toHaveLength(80);
  });
});

describe("leak-guard: what is new since the last look", () => {
  const known: Resources = { ports: [80], children: [{ pid: 5, cmd: "old" }] };

  test("a new port is a server, a new pid is a child; what was known is not repeated", () => {
    const now: Resources = {
      ports: [80, 9000],
      children: [
        { pid: 5, cmd: "old" },
        { pid: 6, cmd: "git worktree add" },
      ],
    };
    expect(newResources(known, now)).toEqual({
      servers: ["a server listening on port 9000"],
      children: ["child process 6 (git worktree add)"],
    });
  });

  test("nothing new is nothing", () => {
    expect(newResources(known, known)).toEqual({ servers: [], children: [] });
  });
});

const PRELOAD = join(import.meta.dir, "preload.ts");

/** Runs `files` as one `bun test` run with the suite's preload; the run's output and exit code. */
async function runFiles(dir: string, files: string[]) {
  const proc = Bun.spawn(
    [process.execPath, "test", "--preload", PRELOAD, ...files.map((f) => join(dir, f))],
    {
      cwd: dir,
      env: { ...process.env, CLAUDECODE: "", FLIGHTDECK_ISOLATION: "" },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { log: `${out}${err}`, code };
}

describe("leak-guard: the preload names the file that leaves something running", () => {
  // The preload looks at /proc, which only Linux has: elsewhere it looks at nothing.
  const linux = process.platform === "linux";
  const SERVER = `
import { test } from "bun:test";
test("starts a server and leaves it", () => {
  (globalThis as { leaked?: unknown }).leaked = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
});
`;
  const CHILD = `
import { test } from "bun:test";
test("starts a child and leaves it", () => {
  Bun.spawn(["sleep", "5"], { stdout: "ignore", stderr: "ignore" });
});
`;
  const BRIEF = `
import { test } from "bun:test";
test("starts a child that ends by itself in a moment", () => {
  Bun.spawn(["sleep", "0.4"], { stdout: "ignore", stderr: "ignore" });
});
`;
  const PLAIN = `
import { expect, test } from "bun:test";
test("does nothing", () => { expect(1).toBe(1); });
`;

  test("a server left listening fails the run and names the file and the port", async () => {
    if (!linux) return;
    const dir = realTempDir("fd-leak-server-");
    writeFileSync(join(dir, "a.test.ts"), SERVER);
    writeFileSync(join(dir, "b.test.ts"), PLAIN);
    const { log, code } = await runFiles(dir, ["a.test.ts", "b.test.ts"]);
    expect(log).toContain("a.test.ts left running: a server listening on port ");
    expect(code).not.toBe(0);
  }, 60_000);

  test("a child left alive fails the run and names the file and the child (#954)", async () => {
    if (!linux) return;
    const dir = realTempDir("fd-leak-child-");
    writeFileSync(join(dir, "a.test.ts"), CHILD);
    writeFileSync(join(dir, "b.test.ts"), PLAIN);
    const { log, code } = await runFiles(dir, ["a.test.ts", "b.test.ts"]);
    expect(log).toContain("a.test.ts left running: child process ");
    expect(log).not.toContain("isolation (warning)");
    expect(code).not.toBe(0);
  }, 60_000);

  test("a child that ends by itself a moment after its file is not a leak", async () => {
    if (!linux) return;
    const dir = realTempDir("fd-leak-brief-");
    writeFileSync(join(dir, "a.test.ts"), BRIEF);
    writeFileSync(join(dir, "b.test.ts"), PLAIN);
    const { log, code } = await runFiles(dir, ["a.test.ts", "b.test.ts"]);
    expect(log).not.toContain("left running");
    expect(code).toBe(0);
  }, 60_000);

  test("two files that leave nothing are not reported", async () => {
    const dir = realTempDir("fd-leak-clean-");
    writeFileSync(join(dir, "a.test.ts"), PLAIN);
    writeFileSync(join(dir, "b.test.ts"), PLAIN);
    const { log, code } = await runFiles(dir, ["a.test.ts", "b.test.ts"]);
    expect(log).not.toContain("left running");
    expect(code).toBe(0);
  }, 60_000);
});

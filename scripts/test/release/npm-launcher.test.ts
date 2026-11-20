import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { BINARIES, binaryFor, exitCodeOf, launch } from "../../../release/npm/launcher.js";

/**
 * Issue #3541: the launcher the npm tarball puts on the PATH as `fd` and `flightdeckd`. It picks the
 * binary the tarball carries for this platform and runs it with the person's arguments: no shell,
 * the path from the package folder, the exit code of the binary.
 */
const DIR = join("/pkg", "flightdeckd");

type Name = "fd" | "flightdeckd";
interface Run {
  spawned: Array<{ path: string; args: string[]; options: unknown }>;
  stderr: string[];
  exits: number[];
  ignored: string[][];
  child: EventEmitter;
}

/** One launch with fakes for the process, the clock-free parts of Node and the child. */
function run(name: Name, argv: string[], platform = "linux", arch = "x64"): Run {
  const state: Run = { spawned: [], stderr: [], exits: [], ignored: [], child: new EventEmitter() };
  launch(name, {
    dir: DIR,
    platform,
    arch,
    argv,
    spawn: (path, args, options) => {
      state.spawned.push({ path, args, options });
      return state.child as never;
    },
    stderr: (line) => state.stderr.push(line),
    exit: (code) => state.exits.push(code),
    ignoreSignals: (signals) => state.ignored.push(signals),
  });
  return state;
}

describe("npm launcher: which binary runs (#3541)", () => {
  test("each platform and architecture the release builds has its binary, any other has none", () => {
    expect([
      binaryFor("linux", "x64"),
      binaryFor("linux", "arm64"),
      binaryFor("win32", "x64"),
      binaryFor("darwin", "arm64"),
      binaryFor("linux", "ia32"),
      binaryFor("win32", "arm64"),
    ]).toEqual([
      "flightdeckd-linux-x64",
      "flightdeckd-linux-arm64",
      "flightdeckd-windows-x64.exe",
      null,
      null,
      null,
    ]);
  });

  test("the table is one entry per binary of the tarball, keyed by platform and architecture", () => {
    expect(BINARIES).toEqual({
      "linux-x64": "flightdeckd-linux-x64",
      "linux-arm64": "flightdeckd-linux-arm64",
      "win32-x64": "flightdeckd-windows-x64.exe",
    });
  });

  test("the exit code of the binary is the exit code of the command, and a signal is 128 plus its number", () => {
    expect([
      exitCodeOf(0, null),
      exitCodeOf(3, null),
      exitCodeOf(null, "SIGINT"),
      exitCodeOf(null, "SIGTERM"),
      exitCodeOf(null, "SIGKILL"),
      exitCodeOf(null, null),
    ]).toEqual([0, 3, 130, 143, 137, 1]);
  });
});

describe("npm launcher: what it runs (#3541)", () => {
  test("flightdeckd runs the binary of its own folder with the arguments as they came", () => {
    const r = run("flightdeckd", ["status", "--json"]);
    expect(r.spawned).toEqual([
      {
        path: join(DIR, "flightdeckd-linux-x64"),
        args: ["status", "--json"],
        options: { stdio: "inherit" },
      },
    ]);
  });

  test("fd names itself to the binary: `fd <subcommand>` is `flightdeckd <subcommand>`", () => {
    const r = run("fd", ["board", "list"], "linux", "arm64");
    expect(r.spawned.map((s) => [s.path, s.args])).toEqual([
      [join(DIR, "flightdeckd-linux-arm64"), ["fd", "board", "list"]],
    ]);
  });

  test("an argument with a space, a quote, a semicolon or a substitution stays one argument", () => {
    const hostile = ["a b", `it's "q"`, "x; rm -rf ~", "$(id)", "`id`", "--flag=a b", ""];
    const r = run("flightdeckd", hostile);
    expect(r.spawned[0]?.args).toEqual(hostile);
    // No shell: the options carry nothing but the stdio the person's terminal needs.
    expect(r.spawned[0]?.options).toEqual({ stdio: "inherit" });
  });

  test("the parent ignores Ctrl-C and a stop while the binary runs, so the binary decides the exit", () => {
    const r = run("flightdeckd", []);
    expect(r.ignored).toEqual([["SIGINT", "SIGTERM"]]);
  });
});

describe("npm launcher: how it ends (#3541)", () => {
  test("it exits with the code of the binary", () => {
    const r = run("flightdeckd", []);
    r.child.emit("exit", 2, null);
    expect(r.exits).toEqual([2]);
  });

  test("a binary killed by a signal ends the command with 128 plus the signal number", () => {
    const r = run("flightdeckd", []);
    r.child.emit("exit", null, "SIGTERM");
    expect(r.exits).toEqual([143]);
  });

  test("a platform or architecture with no binary prints one line and exits 1 without starting anything", () => {
    const r = run("fd", ["status"], "darwin", "arm64");
    expect([r.spawned, r.stderr, r.exits]).toEqual([
      [],
      ["flightdeckd: no binary for darwin-arm64 (supported: linux-x64, linux-arm64, win32-x64)"],
      [1],
    ]);
  });

  test("a binary missing from the package gives one line with its path and exit 1", () => {
    const r = run("flightdeckd", []);
    r.child.emit("error", Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }));
    expect([r.stderr, r.exits]).toEqual([
      [`flightdeckd: cannot run ${join(DIR, "flightdeckd-linux-x64")}: spawn ENOENT`],
      [1],
    ]);
  });
});

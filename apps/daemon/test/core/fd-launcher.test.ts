import { describe, expect, test } from "bun:test";
import { PROTOCOL_VERSION } from "@flightdeck/protocol";
import { parseArgs } from "../../src/cli/domain/args.ts";
import { runCommandCli } from "../../src/cli/run.ts";
import { DAEMON_VERSION } from "../../src/kernel/version.ts";

describe("fd: the command a person types for flightdeckd (issue #3433)", () => {
  test("a bare fd is flightdeckd claude with no arguments, never the daemon", () => {
    const args = parseArgs(["fd"]);
    expect(args.command).toBe("claude");
    expect(args.claudeArgs).toEqual([]);
  });

  test("arguments that are not a Flightdeck subcommand go to claude as they are", () => {
    expect(parseArgs(["fd", "-p", "hi"])).toMatchObject({
      command: "claude",
      claudeArgs: ["-p", "hi"],
    });
    expect(parseArgs(["fd", "--resume"])).toMatchObject({
      command: "claude",
      claudeArgs: ["--resume"],
    });
    expect(parseArgs(["fd", "write", "a", "test"])).toMatchObject({
      command: "claude",
      claudeArgs: ["write", "a", "test"],
    });
  });

  test("a subcommand is the same command as under flightdeckd, flags and all", () => {
    for (const argv of [
      ["sessions", "--json"],
      ["host"],
      ["card", "list", "--project", "api"],
      ["message", "send", "fd-qa", "hello"],
      ["setup", "--yes", "--folders", "/work"],
    ]) {
      expect(parseArgs(["fd", ...argv])).toEqual(parseArgs(argv));
    }
  });

  test("a word claude also has (doctor, mcp, update) means Flightdeck's under fd", () => {
    expect(parseArgs(["fd", "doctor"]).command).toBe("doctor");
    expect(parseArgs(["fd", "mcp"]).command).toBe("mcp");
  });

  test("fd fd is not a loop: the second word goes to claude", () => {
    expect(parseArgs(["fd", "fd"])).toMatchObject({ command: "claude", claudeArgs: ["fd"] });
  });

  test("fd --version answers for Flightdeck, as flightdeckd --version does", () => {
    expect(parseArgs(["fd", "--version"]).command).toBe("version");
  });

  test("fd --help and fd -h print the usage lines and exit 0, as flightdeckd --help does", async () => {
    for (const argv of [["fd", "--help"], ["fd", "-h"], ["--help"]]) {
      const out: string[] = [];
      let code = null as number | null;
      const handled = await runCommandCli(argv, {
        env: {},
        log: { log: (m) => out.push(m), error: (m) => out.push(m) },
        exit: (c) => {
          code = c;
        },
        onSignal: () => {},
      });
      expect(handled).toBe(true);
      expect(code).toBe(0);
      expect(out.join("\n")).toContain("usage: ");
      expect(out.join("\n")).toContain("fd sessions");
    }
  });

  test("the version line names the product and the protocol", async () => {
    const out: string[] = [];
    await runCommandCli(["fd", "--version"], {
      env: {},
      log: { log: (m) => out.push(m), error: (m) => out.push(m) },
      exit: () => {},
      onSignal: () => {},
    });
    expect(out).toEqual([`flightdeckd ${DAEMON_VERSION} (protocolo ${PROTOCOL_VERSION})`]);
  });
});

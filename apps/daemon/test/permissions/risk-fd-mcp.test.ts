import { describe, expect, test } from "bun:test";
import { notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const STARTS =
  "starts or changes an MCP server of a project, a command the project's .mcp.json names, without the person choosing it in the app; a typed --confirm is not the person (flightdeckd mcp test --confirm, save, remove or toggle)";

const HIDDEN =
  "runs a flightdeckd command whose name, noun or verb the shell expands before it runs (a variable, a glob, a brace list or an ANSI-C quote), so the line does not say what it does";

describe("risk rules: a session changing a project's MCP servers from its shell (#3616)", () => {
  test("a confirmed test, remove and an enabling toggle are high, however the CLI is reached", () => {
    expect(
      wrongReasons([
        ["fd mcp test api files --confirm", STARTS],
        ["fd mcp remove api files --confirm", STARTS],
        ["fd mcp save api server.json --confirm", STARTS],
        ["fd mcp save api - --confirm", STARTS],
        ["fd mcp save api server.json", STARTS],
        ["fd mcp toggle api files --enable --confirm", STARTS],
        ["flightdeckd --host pi mcp test api files --confirm --json", STARTS],
        ["FLIGHTDECK_X=1 fd mcp remove api files --confirm", STARTS],
        ['fd "mcp" remove api files --confirm', STARTS],
        ["fd mcp list api && fd mcp remove api files --confirm", STARTS],
        ["bun run apps/daemon/src/bin.ts mcp test api files --confirm", STARTS],
        ["bash -c 'fd mcp toggle api files --enable --confirm'", STARTS],
      ]),
    ).toEqual([]);
  });

  test("a toggle is high unless the only change it asks for is --disable", () => {
    expect(
      wrongReasons([
        ["fd mcp toggle api files --enable", STARTS],
        ["fd mcp toggle api files --disable --session s1 --confirm", STARTS],
        ["fd mcp toggle api files --disable --x=y", STARTS],
        ["fd mcp toggle api files $FLAG", STARTS],
      ]),
    ).toEqual([]);
    expect(
      notHigh([
        "fd mcp toggle api files --disable",
        "fd mcp toggle api files --disable --json --host pi",
      ]),
    ).toEqual([]);
  });

  test("a test is high with any flag but the reading ones, and a verb the shell expands is high", () => {
    expect(
      wrongReasons([
        ["fd mcp test api files --confirm=1", STARTS],
        ["fd mcp test api files $X", STARTS],
        ["A=remove; fd mcp $A api files --confirm", HIDDEN],
        ["fd mcp re{move,list} api files --confirm", HIDDEN],
        ["bash -c 'fd mcp $A api files --confirm'", HIDDEN],
      ]),
    ).toEqual([]);
  });

  test("a test whose flag a runner's shell expands, or that xargs raises, is high", () => {
    expect(
      wrongReasons([
        ["X=--confirm; bun run apps/daemon/src/bin.ts mcp test api files $X", STARTS],
        ["sh -c 'bunx flightdeckd mcp test api files $X'", STARTS],
        ["echo --confirm | xargs fd mcp test api files", HIDDEN],
        ["cat f | xargs -n1 fd mcp test api files", HIDDEN],
        ["echo --confirm | xargs bun run apps/daemon/src/bin.ts mcp test api files", HIDDEN],
      ]),
    ).toEqual([]);
  });

  test("the reads, the preview test and the stdio server stay ordinary shell commands", () => {
    expect(
      notHigh([
        "fd mcp list api",
        "fd mcp status s1 --json",
        "fd mcp test api files",
        "fd mcp test api files --json --host pi",
        "fd mcp",
        "fd mcp --config c.json",
        "fd send fd-qa 'mcp remove api files --confirm'",
        "echo mcp remove api files",
      ]),
    ).toEqual([]);
  });
});

import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs, runCli } from "../src/main.ts";
import { card, fakeDaemon, type Handlers, HOST, stops, TOKEN } from "./card-cli-helpers.ts";
import { tempDir } from "./helpers.ts";

setDefaultTimeout(20_000);

const HANDLERS: Handlers = {
  ...HOST,
  "card.get": ({ cardId }) =>
    cardId === "c1"
      ? card("c1", { title: "Fix login", branch: "card/fix-login" })
      : { error: { code: "not_found", message: "no such card" } },
  "card.start": ({ cardId }) => card(String(cardId), { column: "in_progress" }),
  "card.create": ({ title }) => card("c9", { title: String(title) }),
};

/** `flightdeckd card ...` as the terminal runs it, against a daemon of the test. */
async function terminal(
  args: string[],
  opts: { port?: number; env?: Record<string, string> } = {},
) {
  const daemon = opts.port === undefined ? fakeDaemon(HANDLERS) : { port: opts.port };
  const file = join(tempDir(), "config.json");
  writeFileSync(
    file,
    JSON.stringify({ token: TOKEN, port: daemon.port, dataDir: join(tempDir(), "data") }),
  );
  const out: string[] = [];
  const errors: string[] = [];
  const exits: number[] = [];
  await runCli(["card", ...args, "--config", file], {
    env: opts.env ?? {},
    log: { log: (m) => out.push(m), error: (m) => errors.push(m) },
    exit: (code) => exits.push(code),
    onSignal: () => {},
  });
  return { out, errors, exits, port: daemon.port };
}

describe("card cli: flightdeckd card (issue #1507)", () => {
  test("parseArgs: the four actions and what each one takes", () => {
    expect(parseArgs(["card", "list"])).toMatchObject({ command: "card", action: "list" });
    expect(parseArgs(["card", "list", "--project", "api", "--json"])).toMatchObject({
      action: "list",
      project: "api",
      json: true,
    });
    expect(parseArgs(["card", "show", "c1"])).toMatchObject({ action: "show", cardId: "c1" });
    expect(
      parseArgs(["card", "new", "Add dark mode", "--project", "web", "--description", "see #12"]),
    ).toMatchObject({
      action: "new",
      cardTitle: "Add dark mode",
      project: "web",
      description: "see #12",
    });
    expect(parseArgs(["card", "start", "c1", "--workflow", "review"])).toMatchObject({
      action: "start",
      cardId: "c1",
      workflow: "review",
    });
    expect(() => parseArgs(["card", "discard", "c1"])).toThrow("invalid card action");
    expect(() => parseArgs(["card"])).toThrow("invalid card action");
    expect(() => parseArgs(["card", "show"])).toThrow("missing the card");
    expect(() => parseArgs(["card", "start"])).toThrow("missing the card");
    expect(() => parseArgs(["card", "new"])).toThrow("missing the title");
  });

  test("the usage names the command and its four actions", () => {
    let usage = "";
    try {
      parseArgs(["card", "discard"]);
    } catch (error) {
      usage = (error as Error).message;
    }
    for (const line of [
      "flightdeckd card list [--project <name or id>] [--json] [--config <file>]",
      "flightdeckd card show <card> [--json] [--config <file>]",
      "flightdeckd card new <title> [--project <name or id>] [--description <text>] [--json] [--config <file>]",
      "flightdeckd card start <card> [--workflow <name>] [--json] [--config <file>]",
    ])
      expect(usage).toContain(line);
  });

  test("list prints one line per card and exits 0", async () => {
    const run = await terminal(["list", "--project", "web"]);
    expect(run.out).toEqual(["web  c3  backlog  Dark mode"]);
    expect(run.errors).toEqual([]);
    expect(run.exits).toEqual([0]);
  });

  test("show, new and start print what the daemon did", async () => {
    expect((await terminal(["show", "c1"])).out).toContain("branch: card/fix-login");
    expect((await terminal(["new", "T", "--project", "api"])).out).toEqual(["created c9  T"]);
    expect((await terminal(["start", "c1"])).out).toEqual(["started c1  card c1"]);
  });

  test("a refusal is exit 1 on stderr, and no daemon is exit 2", async () => {
    const refused = await terminal(["show", "nope"]);
    expect(refused.exits).toEqual([1]);
    expect(refused.out).toEqual([]);
    expect(refused.errors.join("\n")).toContain("not_found: no such card");

    const gone = fakeDaemon(HANDLERS);
    await Promise.all(stops.splice(0).map(async (stop) => stop()));
    const down = await terminal(["list"], { port: gone.port });
    expect(down.exits).toEqual([2]);
    expect(down.errors.join("\n")).toContain("could not reach the daemon");
  });

  test("the token comes from the config file only: not from --token, not from the environment", async () => {
    const flagged = await terminal(["list", "--token", "flag-token-0123456789abcdef"]);
    expect(flagged.exits).toEqual([1]);
    expect(flagged.out).toEqual([]);
    expect(flagged.errors.join("\n")).toContain("config file");
    expect(flagged.errors.join("\n")).not.toContain("flag-token-0123456789abcdef");

    // The environment holds another token; the config's is the one the daemon accepts.
    const env = {
      FLIGHTDECK_TOKEN: "env-token-0123456789abcdef",
      FLIGHTDECK_HOOKS_TOKEN: "env-token-0123456789abcdef",
    };
    const run = await terminal(["list", "--project", "web"], { env });
    expect(run.exits).toEqual([0]);
    expect(run.out).toEqual(["web  c3  backlog  Dark mode"]);
  });
});

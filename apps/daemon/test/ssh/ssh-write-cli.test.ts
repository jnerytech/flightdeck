import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { CLOSE, fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const NOW = "2026-11-20T09:00:00Z";
const target = (id: string, name: string) => ({
  id,
  name,
  host: `${name}.internal`,
  port: 22,
  user: "deploy",
  viaHost: null,
  auth: "agent",
  secretRef: null,
  jump: null,
  options: {},
  tags: [],
  hostKey: null,
  createdAt: NOW,
  updatedAt: NOW,
});
const TARGETS = [target("t1", "prod"), target("t2", "twin"), target("t3", "twin")];

const OPEN: Handlers = {
  "ssh.list": () => ({ targets: TARGETS }),
  "ssh.remove": () => ({}),
  "ssh.import.apply": () => ({ created: [target("t9", "staging")], skipped: [] }),
};

/** The one JSON value a `--json` run printed, or null when it printed none. */
const printed = (out: string[]) => {
  try {
    return JSON.parse(out.join("\n")) as unknown;
  } catch {
    return null;
  }
};

const callsOf = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type).map((c) => c.payload);

describe("flightdeckd ssh remove (issue #3537)", () => {
  test("a confirmed removal names the id the name stands for and says what it did", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["ssh", "remove", "prod", "--confirm"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: ["prod: removed"],
      err: [],
    });
    expect(callsOf(daemon, "ssh.remove")).toEqual([{ id: "t1", confirm: true }]);
  });

  test("without --confirm nothing is sent: the refusal says what the removal does", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["ssh", "remove", "prod"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("ssh remove deletes the destination: pass --confirm");
    expect(daemon.calls).toEqual([]);
  });

  test("--json prints the removed destination's id and name", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["ssh", "remove", "t1", "--confirm", "--json"], daemon.port);
    expect(run.code).toBe(0);
    expect(printed(run.out)).toEqual({ id: "t1", name: "prod", removed: true });
  });

  test("a name no destination has, or two share, removes nothing", async () => {
    const daemon = fakeDaemon(OPEN);
    const none = await flightdeckd(["ssh", "remove", "nope", "--confirm"], daemon.port);
    const two = await flightdeckd(["ssh", "remove", "twin", "--confirm"], daemon.port);
    expect([none.code, none.err.join("")]).toEqual([1, "flightdeckd: no such ssh target: nope"]);
    expect([two.code, two.err.join("")]).toEqual([
      1,
      "flightdeckd: 2 ssh targets are named twin: use an id (t2, t3)",
    ]);
    expect(callsOf(daemon, "ssh.remove")).toEqual([]);
  });

  test("a refusal of the daemon (a jump host another destination uses) is one line, exit 1", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "ssh.remove": () => ({
        error: { code: "invalid_state", message: "db goes through this destination" },
      }),
    });
    const run = await flightdeckd(["ssh", "remove", "prod", "--confirm"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("db goes through this destination");
  });

  test("a daemon that closes the connection is exit 2, and the text never says it was removed", async () => {
    const daemon = fakeDaemon({ ...OPEN, "ssh.remove": () => CLOSE });
    const run = await flightdeckd(["ssh", "remove", "prod", "--confirm"], daemon.port);
    expect(run.code).toBe(2);
    expect(run.out).toEqual([]);
  });
});

describe("flightdeckd ssh import apply (issue #3537)", () => {
  test("the aliases named are the ones sent, and each created or skipped one is a line", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "ssh.import.apply": () => ({
        created: [target("t9", "staging")],
        skipped: [{ alias: "prod", reason: "already exists", why: "ssh_import_exists" }],
      }),
    });
    const run = await flightdeckd(
      ["ssh", "import", "apply", "--alias", "staging", "--alias", "prod"],
      daemon.port,
    );
    expect({ code: run.code, out: run.out }).toEqual({
      code: 1,
      out: ["staging: imported as t9", "prod: skipped, already exists"],
    });
    expect(callsOf(daemon, "ssh.import.apply")).toEqual([{ aliases: ["staging", "prod"] }]);
  });

  test("when everything named was imported the exit code is 0", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["ssh", "import", "apply", "--alias", "staging"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: ["staging: imported as t9"],
      err: [],
    });
  });

  test("--json prints the result as the daemon returns it, and a skip still makes the exit code 1", async () => {
    const result = {
      created: [],
      skipped: [{ alias: "gone", reason: "not in ~/.ssh/config", why: "ssh_import_not_in_config" }],
    };
    const daemon = fakeDaemon({ ...OPEN, "ssh.import.apply": () => result });
    const run = await flightdeckd(
      ["ssh", "import", "apply", "--alias", "gone", "--json"],
      daemon.port,
    );
    expect(run.code).toBe(1);
    expect(printed(run.out)).toEqual(result);
  });

  test("a refusal of the daemon is one line on stderr, exit 1", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "ssh.import.apply": () => ({ error: { code: "invalid_state", message: "no config" } }),
    });
    const run = await flightdeckd(["ssh", "import", "apply", "--alias", "a"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("no config");
  });

  test("a daemon that closes the connection is exit 2", async () => {
    const daemon = fakeDaemon({ ...OPEN, "ssh.import.apply": () => CLOSE });
    const run = await flightdeckd(["ssh", "import", "apply", "--alias", "a"], daemon.port);
    expect(run.code).toBe(2);
  });
});

describe("the arguments of ssh remove and ssh import apply (issue #3537)", () => {
  const parsed = (argv: string[]) => {
    try {
      return parseArgs(argv);
    } catch (error) {
      return { refusedWith: (error as Error).message };
    }
  };

  test("remove reads its target and --confirm, apply its repeated --alias", () => {
    expect(parsed(["ssh", "remove", "prod", "--confirm", "--host", "pi"])).toMatchObject({
      command: "ssh",
      action: "remove",
      sshTarget: "prod",
      confirm: true,
      host: "pi",
    });
    expect(parsed(["ssh", "import", "apply", "--alias", "a", "--alias", "b"])).toMatchObject({
      command: "ssh",
      action: "import-apply",
      sshAliases: ["a", "b"],
    });
  });

  test("apply with no alias is refused before anything is sent, and the daemon's limit of 500 holds", () => {
    expect(JSON.stringify(parsed(["ssh", "import", "apply"]))).toContain(
      "ssh import apply needs at least one --alias",
    );
    const many = Array.from({ length: 501 }, (_, i) => ["--alias", `h${i}`]).flat();
    expect(JSON.stringify(parsed(["ssh", "import", "apply", ...many]))).toContain(
      "at most 500 --alias",
    );
  });

  test("--alias and --confirm are refused on the verbs they do not belong to", () => {
    expect(JSON.stringify(parsed(["ssh", "list", "--alias", "a"]))).toContain(
      "--alias: this flag only applies to flightdeckd ssh import apply",
    );
    expect(JSON.stringify(parsed(["ssh", "test", "prod", "--confirm"]))).toContain(
      "--confirm: this flag only applies to flightdeckd ssh remove",
    );
    expect(JSON.stringify(parsed(["ssh", "import", "preview", "--confirm"]))).toContain(
      "--confirm: this flag only applies to flightdeckd ssh remove",
    );
  });

  test("a missing target is refused, and so is an import verb that is not preview or apply", () => {
    expect(JSON.stringify(parsed(["ssh", "remove", "--confirm"]))).toContain(
      "missing the ssh target",
    );
    expect(JSON.stringify(parsed(["ssh", "import", "all"]))).toContain("invalid ssh import action");
  });
});

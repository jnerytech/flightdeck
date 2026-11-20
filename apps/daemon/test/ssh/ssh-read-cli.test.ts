import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { runSshCli } from "../../src/ssh/index.ts";
import { CLOSE, config, fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const NOW = "2026-11-20T09:00:00Z";
const TARGET = {
  id: "t1",
  name: "prod",
  host: "10.0.0.5",
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
};
const FULL = {
  ...TARGET,
  id: "t2",
  name: "db",
  host: "db.internal",
  port: 2222,
  user: "ops",
  viaHost: "pi",
  auth: "vault-key",
  secretRef: "sec-9",
  jump: "prod",
  tags: ["db", "eu"],
  hostKey: "SHA256:abcdef",
};
const ENTRY = {
  alias: "web",
  host: "web.example.com",
  port: 22,
  user: "www",
  identityFile: null,
  proxyJump: null,
  exists: false,
};

const OPEN: Handlers = {
  "ssh.list": () => ({ targets: [TARGET, FULL] }),
  "ssh.import.preview": () => ({
    entries: [
      ENTRY,
      {
        ...ENTRY,
        alias: "old",
        port: 2200,
        identityFile: "~/.ssh/id_old",
        proxyJump: "web",
        exists: true,
      },
    ],
  }),
};

const callsOf = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type).map((c) => c.payload);

describe("flightdeckd ssh list (issue #3537)", () => {
  test("a target is one line: its name, id, address, auth and the host key it pins", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["ssh", "list"], daemon.port);
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(run.out).toEqual([
      "prod  t1  deploy@10.0.0.5:22  agent  host key: not pinned",
      "db  t2  ops@db.internal:2222  vault-key  host key: SHA256:abcdef  via: pi  jump: prod  secret: sec-9  tags: db, eu",
    ]);
    expect(callsOf(daemon, "ssh.list")).toEqual([{}]);
  });

  test("--json prints the targets as the protocol returns them, with null for a missing field", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["ssh", "list", "--json"], daemon.port);
    expect(run.code).toBe(0);
    expect(JSON.parse(run.out.join("\n"))).toEqual({ targets: [TARGET, FULL] });
  });

  test("with none it says so, and --json prints an empty list", async () => {
    const daemon = fakeDaemon({ ...OPEN, "ssh.list": () => ({ targets: [] }) });
    const text = await flightdeckd(["ssh", "list"], daemon.port);
    expect({ code: text.code, out: text.out }).toEqual({ code: 0, out: ["no ssh target"] });
    const asJson = await flightdeckd(["ssh", "list", "--json"], daemon.port);
    expect(JSON.parse(asJson.out.join("\n"))).toEqual({ targets: [] });
  });

  test("a name that carries terminal controls is printed without them, in the text and in --json", async () => {
    const hostile = { ...TARGET, name: "ok\u001b[2Jgone‮x" };
    const daemon = fakeDaemon({ ...OPEN, "ssh.list": () => ({ targets: [hostile] }) });
    const text = await flightdeckd(["ssh", "list"], daemon.port);
    expect(text.out.join("\n")).toContain("ok [2Jgone x  t1");
    const asJson = await flightdeckd(["ssh", "list", "--json"], daemon.port);
    expect(asJson.out.join("\n")).not.toContain("\u001b");
  });

  test("the daemon's refusal is one line on stderr, exit 1", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "ssh.list": () => ({ error: { code: "feature_off", message: "ssh is off" } }),
    });
    const run = await flightdeckd(["ssh", "list"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("ssh is off");
  });

  test("a read with no answer exits 2 and never says it may have changed something", async () => {
    const daemon = fakeDaemon({ ...OPEN, "ssh.list": () => undefined });
    const result = await runSshCli({ action: "list" }, config(daemon.port), { timeoutMs: 300 });
    expect(result.code).toBe(2);
    expect(result.err.join("\n")).not.toContain("may or may not");
  });
});

describe("flightdeckd ssh import preview (issue #3537)", () => {
  test("an entry is one line: its alias, address, key and jump, and whether it is registered", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["ssh", "import", "preview"], daemon.port);
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(run.out).toEqual([
      "web  www@web.example.com:22",
      "old  www@web.example.com:2200  key: ~/.ssh/id_old  jump: web  already registered",
    ]);
    expect(callsOf(daemon, "ssh.import.preview")).toEqual([{}]);
  });

  test("--json prints the entries as the protocol returns them", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["ssh", "import", "preview", "--json"], daemon.port);
    expect(run.code).toBe(0);
    expect(JSON.parse(run.out.join("\n")).entries).toHaveLength(2);
    expect(JSON.parse(run.out.join("\n")).entries[0]).toEqual(ENTRY);
  });

  test("with nothing to import it says so, and --json prints an empty list", async () => {
    const daemon = fakeDaemon({ ...OPEN, "ssh.import.preview": () => ({ entries: [] }) });
    const text = await flightdeckd(["ssh", "import", "preview"], daemon.port);
    expect({ code: text.code, out: text.out }).toEqual({
      code: 0,
      out: ["no host in ~/.ssh/config"],
    });
    const asJson = await flightdeckd(["ssh", "import", "preview", "--json"], daemon.port);
    expect(JSON.parse(asJson.out.join("\n"))).toEqual({ entries: [] });
  });
});

describe("flightdeckd ssh, as the terminal runs it (issue #3537)", () => {
  test("a daemon that closes before it answers exits 2", async () => {
    const daemon = fakeDaemon({ ...OPEN, "ssh.list": () => CLOSE });
    const run = await flightdeckd(["ssh", "list"], daemon.port);
    expect(run.code).toBe(2);
  });

  test("no daemon at the address of the config: exit 2", async () => {
    const daemon = fakeDaemon({});
    const port = daemon.port;
    await stopAll();
    const run = await flightdeckd(["ssh", "list"], port);
    expect(run.code).toBe(2);
    expect(run.err.join("\n")).toContain("could not reach the daemon");
  });
});

describe("the arguments of ssh (issue #3537)", () => {
  const parsed = (argv: string[]) => {
    try {
      return parseArgs(argv);
    } catch (error) {
      return { refusedWith: (error as Error).message };
    }
  };

  test("each verb is read with --json and --host", () => {
    expect(parsed(["ssh", "list", "--json"])).toMatchObject({
      command: "ssh",
      action: "list",
      json: true,
    });
    expect(parsed(["ssh", "import", "preview", "--host", "pi"])).toMatchObject({
      command: "ssh",
      action: "import-preview",
      host: "pi",
    });
  });

  test("a missing or unknown verb is refused before anything is sent", () => {
    expect(JSON.stringify(parsed(["ssh"]))).toContain("invalid ssh action");
    expect(JSON.stringify(parsed(["ssh", "bogus"]))).toContain("invalid ssh action");
    expect(JSON.stringify(parsed(["ssh", "import"]))).toContain("invalid ssh import action");
    expect(JSON.stringify(parsed(["ssh", "import", "apply"]))).toContain(
      "invalid ssh import action",
    );
  });

  test("a verb that reads no target is refused when it is given one, so a typo cannot pass", () => {
    expect(JSON.stringify(parsed(["ssh", "list", "prod"]))).toContain("unknown argument: prod");
    expect(JSON.stringify(parsed(["ssh", "import", "preview", "web"]))).toContain(
      "unknown argument: web",
    );
  });
});

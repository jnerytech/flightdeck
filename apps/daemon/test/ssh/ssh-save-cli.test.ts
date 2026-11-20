import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { CLOSE, fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const NOW = "2026-11-20T09:00:00Z";
const target = (id: string, name: string, more: Record<string, unknown> = {}) => ({
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
  ...more,
});
const PROD = target("t1", "prod", {
  port: 2200,
  viaHost: "pi",
  auth: "password",
  secretRef: "vault-item-1",
  jump: "t2",
  options: { compression: true, serverAliveInterval: 30 },
  tags: ["live", "eu"],
  hostKey: "SHA256:pinned",
});
const TARGETS = [PROD, target("t2", "db"), target("t3", "twin"), target("t4", "twin")];

const OPEN: Handlers = {
  "ssh.list": () => ({ targets: TARGETS }),
  // Like the daemon: a changed address or port clears the pinned key, anything else keeps it.
  "ssh.save": (payload) => {
    const before = TARGETS.find((t) => t.id === payload.id);
    const kept = before?.host === payload.host && before?.port === payload.port;
    return target(String(payload.id ?? "t9"), String(payload.name), {
      hostKey: kept ? before.hostKey : null,
    });
  },
};

/** The one JSON value a `--json` run printed, or null when it printed none. */
const printed = (out: string[]) => {
  try {
    return JSON.parse(out.join("\n")) as unknown;
  } catch {
    return null;
  }
};

const saves = (daemon: ReturnType<typeof fakeDaemon>) =>
  daemon.calls.filter((c) => c.type === "ssh.save").map((c) => c.payload);

const ADD = ["ssh", "add", "web", "--address", "web.internal", "--user", "deploy"];

describe("flightdeckd ssh add (issue #3537)", () => {
  test("a destination with its address and user is sent with nothing else, and the daemon's id is printed", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(ADD, daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: ["web: added as t9"],
      err: [],
    });
    expect(saves(daemon)).toEqual([{ name: "web", host: "web.internal", user: "deploy" }]);
  });

  test("port, auth, key path and jump are sent; a jump named by its name goes as its id", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(
      [
        ...ADD,
        "--port",
        "2222",
        "--auth",
        "key-file",
        "--secret-ref",
        "/home/me/key",
        "--jump",
        "db",
      ],
      daemon.port,
    );
    expect(run.code).toBe(0);
    expect(saves(daemon)).toEqual([
      {
        name: "web",
        host: "web.internal",
        user: "deploy",
        port: 2222,
        auth: "key-file",
        secretRef: "/home/me/key",
        jump: "t2",
      },
    ]);
  });

  test("--forward-agent with --confirm sends ForwardAgent on and the confirmation", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd([...ADD, "--forward-agent", "--confirm"], daemon.port);
    expect(run.code).toBe(0);
    expect(saves(daemon)).toEqual([
      {
        name: "web",
        host: "web.internal",
        user: "deploy",
        options: { forwardAgent: true },
        confirm: true,
      },
    ]);
  });

  test("a name a destination already has is refused and nothing is saved", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(
      ["ssh", "add", "prod", "--address", "x.internal", "--user", "deploy"],
      daemon.port,
    );
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("a destination is already named prod: use ssh edit prod");
    expect(saves(daemon)).toEqual([]);
  });

  test("a jump no destination has is refused and nothing is saved", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd([...ADD, "--jump", "nope"], daemon.port);
    expect([run.code, run.err.join("")]).toEqual([1, "flightdeckd: no such ssh target: nope"]);
    expect(saves(daemon)).toEqual([]);
  });

  test("--json prints the destination as the daemon returns it", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd([...ADD, "--json"], daemon.port);
    expect(run.code).toBe(0);
    expect(printed(run.out)).toMatchObject({ id: "t9", name: "web", hostKey: null });
  });

  test("a daemon refusal is one line on stderr, exit 1; a daemon that closes is exit 2", async () => {
    const refused = fakeDaemon({
      ...OPEN,
      "ssh.save": () => ({ error: { code: "invalid_request", message: "invalid host" } }),
    });
    const run = await flightdeckd(ADD, refused.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("invalid host");
    const closed = await flightdeckd(ADD, fakeDaemon({ ...OPEN, "ssh.save": () => CLOSE }).port);
    expect(closed.code).toBe(2);
  });
});

describe("flightdeckd ssh edit (issue #3537)", () => {
  test("a change keeps every other field: the whole destination goes back with its id", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["ssh", "edit", "prod", "--user", "ops"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: ["prod: updated"],
      err: [],
    });
    expect(saves(daemon)).toEqual([
      {
        id: "t1",
        name: "prod",
        host: "prod.internal",
        port: 2200,
        user: "ops",
        viaHost: "pi",
        auth: "password",
        secretRef: "vault-item-1",
        jump: "t2",
        options: { compression: true, serverAliveInterval: 30 },
        tags: ["live", "eu"],
      },
    ]);
  });

  test("a new address says the pinned host key was cleared, so the person checks it again", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(
      ["ssh", "edit", "prod", "--address", "new.internal"],
      daemon.port,
    );
    expect(run.code).toBe(0);
    expect(run.out).toEqual([
      "prod: updated, its pinned host key was cleared: run flightdeckd ssh hostkey check prod",
    ]);
  });

  test("a destination with no pinned key says nothing about one", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["ssh", "edit", "db", "--address", "new.internal"], daemon.port);
    expect(run.out).toEqual(["db: updated"]);
  });

  test("a new auth drops the old reference unless one is given, and agent never keeps one", async () => {
    const daemon = fakeDaemon(OPEN);
    await flightdeckd(["ssh", "edit", "prod", "--auth", "agent"], daemon.port);
    await flightdeckd(["ssh", "edit", "prod", "--auth", "key-file"], daemon.port);
    await flightdeckd(
      ["ssh", "edit", "prod", "--auth", "key-file", "--secret-ref", "/k"],
      daemon.port,
    );
    expect(saves(daemon).map((s) => [s.auth, s.secretRef])).toEqual([
      ["agent", null],
      ["key-file", null],
      ["key-file", "/k"],
    ]);
  });

  test("--no-jump clears the jump and --jump names another by its name", async () => {
    const daemon = fakeDaemon(OPEN);
    await flightdeckd(["ssh", "edit", "prod", "--no-jump"], daemon.port);
    await flightdeckd(["ssh", "edit", "prod", "--jump", "t2"], daemon.port);
    expect(saves(daemon).map((s) => s.jump)).toEqual([null, "t2"]);
  });

  test("--no-forward-agent turns it off and keeps the other options", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "ssh.list": () => ({
        targets: [target("t1", "prod", { options: { compression: true, forwardAgent: true } })],
      }),
    });
    const run = await flightdeckd(["ssh", "edit", "prod", "--no-forward-agent"], daemon.port);
    expect(run.code).toBe(0);
    expect(saves(daemon).map((s) => s.options)).toEqual([
      { compression: true, forwardAgent: false },
    ]);
  });

  test("--forward-agent and --confirm turn it on for a destination that had it off", async () => {
    const daemon = fakeDaemon(OPEN);
    await flightdeckd(["ssh", "edit", "db", "--forward-agent", "--confirm"], daemon.port);
    expect(saves(daemon).map((s) => [s.options, s.confirm])).toEqual([
      [{ forwardAgent: true }, true],
    ]);
  });

  test("a name no destination has, or two share, asks the daemon for nothing", async () => {
    const daemon = fakeDaemon(OPEN);
    const none = await flightdeckd(["ssh", "edit", "nope", "--port", "22"], daemon.port);
    const two = await flightdeckd(["ssh", "edit", "twin", "--port", "22"], daemon.port);
    expect([none.code, none.err.join("")]).toEqual([1, "flightdeckd: no such ssh target: nope"]);
    expect([two.code, two.err.join("")]).toEqual([
      1,
      "flightdeckd: 2 ssh targets are named twin: use an id (t3, t4)",
    ]);
    expect(saves(daemon)).toEqual([]);
  });

  test("--json prints the destination as the daemon returns it", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["ssh", "edit", "prod", "--port", "2300", "--json"], daemon.port);
    expect(run.code).toBe(0);
    expect(printed(run.out)).toMatchObject({ id: "t1", name: "prod" });
  });
});

describe("the arguments of ssh add and ssh edit (issue #3537)", () => {
  const parsed = (argv: string[]) => {
    try {
      return parseArgs(argv);
    } catch (error) {
      return { refusedWith: (error as Error).message };
    }
  };
  const refused = (argv: string[]) => JSON.stringify(parsed(argv));

  test("add reads its name and flags; edit reads its target", () => {
    expect(parsed([...ADD, "--port", "2222", "--host", "pi"])).toMatchObject({
      command: "ssh",
      action: "add",
      sshTarget: "web",
      host: "pi",
      sshSave: { address: "web.internal", user: "deploy", port: 2222 },
    });
    expect(parsed(["ssh", "edit", "prod", "--no-jump", "--auth", "agent"])).toMatchObject({
      action: "edit",
      sshTarget: "prod",
      sshSave: { noJump: true, auth: "agent" },
    });
  });

  test("add needs --address and --user; edit needs a change", () => {
    expect(refused(["ssh", "add", "web", "--user", "deploy"])).toContain(
      "ssh add needs --address <host>",
    );
    expect(refused(["ssh", "add", "web", "--address", "web.internal"])).toContain(
      "ssh add needs --user <name>",
    );
    expect(refused(["ssh", "add"])).toContain("missing the ssh target");
    expect(refused(["ssh", "edit", "prod"])).toContain("ssh edit needs at least one of");
  });

  test("a port, an auth or a flag pair that cannot be sent is refused before anything is sent", () => {
    expect(refused([...ADD, "--port", "0"])).toContain("--port: a whole number from 1 to 65535");
    expect(refused([...ADD, "--port", "22x"])).toContain("--port: a whole number from 1 to 65535");
    expect(refused([...ADD, "--auth", "telnet"])).toContain(
      "--auth: agent, key-file, vault-key or password",
    );
    expect(refused(["ssh", "edit", "prod", "--jump", "db", "--no-jump"])).toContain(
      "--jump and --no-jump cannot go together",
    );
    expect(
      refused(["ssh", "edit", "prod", "--forward-agent", "--no-forward-agent", "--confirm"]),
    ).toContain("--forward-agent and --no-forward-agent cannot go together");
  });

  test("ForwardAgent on hands the agent to the remote host: it needs --confirm", () => {
    expect(refused([...ADD, "--forward-agent"])).toContain(
      "--forward-agent hands your agent to the remote host: pass --confirm",
    );
  });

  test("--no-jump and --no-forward-agent are for edit, and every ssh flag belongs to add or edit", () => {
    expect(refused([...ADD, "--no-jump"])).toContain(
      "--no-jump: this flag only applies to flightdeckd ssh edit",
    );
    expect(refused(["ssh", "list", "--address", "x"])).toContain(
      "--address: this flag only applies to flightdeckd ssh add and ssh edit",
    );
    expect(refused(["ssh", "remove", "prod", "--confirm", "--port", "22"])).toContain(
      "--port: this flag only applies to flightdeckd ssh add and ssh edit",
    );
  });

  test("--confirm is allowed on add and edit, not on the other verbs", () => {
    expect(parsed([...ADD, "--confirm"])).toMatchObject({ action: "add", confirm: true });
    expect(refused(["ssh", "list", "--confirm"])).toContain(
      "--confirm: this flag only applies to flightdeckd ssh remove, add or edit",
    );
  });
});

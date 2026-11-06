import { afterEach, describe, expect, test } from "bun:test";
import { BgService } from "../src/bg/service.ts";
import { FlightdeckError } from "../src/errors.ts";
import { startServer } from "../src/server.ts";
import { EventStore } from "../src/store/event-store.ts";
import { whichOnPath } from "../src/which.ts";
import { installFakeClaude } from "./fake-claude.ts";
import { newManager, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "bg-control-token-0123456789";
const SESSION = "11111111-2222-4333-8444-555555555555";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const RUNNING = {
  cwd: "/work/app",
  kind: "background",
  startedAt: 1,
  id: "7c5dcf5d",
  state: "blocked",
  pid: 4242,
  status: "waiting",
  waitingFor: "permission prompt",
  sessionId: SESSION,
};
const DONE = {
  cwd: "/work/app",
  kind: "background",
  startedAt: 2,
  id: "a1b2c3d4",
  state: "done",
  sessionId: "99999999-0000-4000-8000-000000000000",
};
const LOST = {
  cwd: "/work/app",
  kind: "background",
  startedAt: 3,
  id: "ffffffff",
  state: "stopped",
};

function setup(
  channel?: (id: string, text: string) => boolean,
  trust?: (cwd: string) => { trusted: boolean; configRoot?: string },
  prepare?: (cwd: string) => Promise<void>,
) {
  const fake = installFakeClaude([]);
  cleanups.push(fake.restore);
  fake.setAgents([RUNNING, DONE, LOST]);
  const service = new BgService({
    db: new EventStore(":memory:").db,
    claude: () => whichOnPath("claude"),
    ...(channel ? { channel } : {}),
    ...(trust ? { trust } : {}),
    ...(prepare ? { prepare } : {}),
  });
  return { fake, service };
}

const cli = (fake: ReturnType<typeof installFakeClaude>) =>
  fake
    .events()
    .filter((e) => e.type === "cli" && (e.args as string[])[0] !== "agents")
    .map((e) => e.args);
const starts = (fake: ReturnType<typeof installFakeClaude>) =>
  fake
    .events()
    .filter((e) => e.type === "start")
    .map((e) => e.args);

async function refused(run: () => Promise<unknown>): Promise<FlightdeckError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof FlightdeckError) return error;
    throw error;
  }
  throw new Error("accepted");
}

describe("bg-controlar: stop and restart", () => {
  test("stop and respawn run the claude command on the id and answer with the listing", async () => {
    const { fake, service } = setup();
    const stopped = await service.stop("7c5dcf5d");
    const respawned = await service.respawn("a1b2c3d4");
    expect(cli(fake)).toEqual([
      ["stop", "7c5dcf5d"],
      ["respawn", "a1b2c3d4"],
    ]);
    expect(stopped.sessions).toHaveLength(3);
    expect(respawned.supported).toBe(true);
  });

  test("an id the listing does not have is refused before claude is asked, and a claude that refuses is reported", async () => {
    const { fake, service } = setup();
    const missing = await refused(() => service.stop("00000000"));
    expect(missing.reason).toBe("bg_not_found");
    expect(missing.params).toEqual({ id: "00000000" });
    expect(cli(fake)).toEqual([]);
    fake.failCli(true);
    fake.setAgents([RUNNING]);
    const failed = await refused(() => service.respawn("7c5dcf5d"));
    expect(failed.reason).toBe("bg_cli_failed");
    expect(String(failed.params?.message)).toContain("no such session");
  });
});

describe("bg-controlar: respawn in a folder not trusted (review of #196)", () => {
  test("is refused: claude respawn takes no flags, so it cannot be told to leave the project's hooks and servers out", async () => {
    const { fake, service } = setup(undefined, () => ({ trusted: false }));
    const error = await refused(() => service.respawn("7c5dcf5d"));
    expect(error.reason).toBe("bg_untrusted");
    expect(cli(fake)).toEqual([]);
  });

  test("runs in a trusted folder, after the folder's boundaries were looked at", async () => {
    const order: string[] = [];
    const { fake, service } = setup(
      undefined,
      () => ({ trusted: true }),
      async (cwd) => void order.push(`prepare ${cwd}`),
    );
    await service.respawn("7c5dcf5d");
    expect(order).toEqual(["prepare /work/app"]);
    expect(cli(fake)).toEqual([["respawn", "7c5dcf5d"]]);
  });

  test("is refused in a trusted worktree: the respawn cannot be given the main checkout to read the configuration from (review of #196)", async () => {
    const { fake, service } = setup(undefined, () => ({ trusted: true, configRoot: "/work/main" }));
    const error = await refused(() => service.respawn("7c5dcf5d"));
    expect(error.reason).toBe("bg_worktree_respawn");
    expect(cli(fake)).toEqual([]);
  });
});

describe("bg-controlar: a message", () => {
  test("a session with a channel gets it through the channel, and claude is not run", async () => {
    const sent: Array<[string, string]> = [];
    const { fake, service } = setup((id, text) => {
      sent.push([id, text]);
      return true;
    });
    await service.message("7c5dcf5d", "continue");
    expect(sent).toEqual([[SESSION, "continue"]]);
    expect(cli(fake)).toEqual([]);
    expect(starts(fake)).toEqual([]);
  });

  test("a session that is running with no channel cannot be told anything", async () => {
    const { fake, service } = setup(() => false);
    const error = await refused(() => service.message("7c5dcf5d", "continue"));
    expect(error.reason).toBe("bg_no_message_path");
    expect(starts(fake)).toEqual([]);
  });

  test("a session with no process is continued in the background, with the message as its prompt", async () => {
    const { fake, service } = setup();
    await service.message("a1b2c3d4", "--not-a-flag, continue");
    expect(starts(fake)).toEqual([
      ["--resume", "99999999-0000-4000-8000-000000000000", "--bg", "--", "--not-a-flag, continue"],
    ]);
  });

  test("a session in a folder not trusted is continued without the project's hooks and servers, and one in a card's worktree reads the project's setup", async () => {
    const untrusted = setup(undefined, () => ({ trusted: false }));
    await untrusted.service.message("a1b2c3d4", "continue");
    expect(starts(untrusted.fake)).toEqual([
      [
        "--resume",
        "99999999-0000-4000-8000-000000000000",
        "--bg",
        "--setting-sources",
        "user",
        "--strict-mcp-config",
        "--",
        "continue",
      ],
    ]);
    const asked: string[] = [];
    const worktree = setup(undefined, (cwd) => {
      asked.push(cwd);
      return { trusted: true, configRoot: "/work/main" };
    });
    await worktree.service.message("a1b2c3d4", "continue");
    expect(asked).toEqual(["/work/app"]);
    expect(starts(worktree.fake)).toEqual([
      [
        "--resume",
        "99999999-0000-4000-8000-000000000000",
        "--bg",
        "--project-config-root",
        "/work/main",
        "--",
        "continue",
      ],
    ]);
  });

  test("the folder's git boundaries are looked at before a continued session is told whether it is trusted (review of #196)", async () => {
    const order: string[] = [];
    const { service } = setup(
      undefined,
      (cwd) => {
        order.push(`decide ${cwd}`);
        return { trusted: true };
      },
      async (cwd) => {
        await Promise.resolve();
        order.push(`prepare ${cwd}`);
      },
    );
    await service.message("a1b2c3d4", "continue");
    expect(order).toEqual(["prepare /work/app", "decide /work/app"]);
  });

  test("one with no Claude session id cannot be continued, and a claude that refuses is reported", async () => {
    const { fake, service } = setup();
    expect((await refused(() => service.message("ffffffff", "oi"))).reason).toBe(
      "bg_no_message_path",
    );
    expect((await refused(() => service.message("00000000", "oi"))).reason).toBe("bg_not_found");
    expect(starts(fake)).toEqual([]);
    fake.failCli(true);
    const failed = await refused(() => service.message("a1b2c3d4", "oi"));
    expect(failed.reason).toBe("bg_cli_failed");
    expect(String(failed.params?.message)).toContain("cannot start in the background");
  });
});

describe("bg-controlar: over the protocol", () => {
  async function served() {
    const { fake, service } = setup(() => true);
    const { manager, root } = newManager();
    const server = startServer({
      manager,
      bg: service,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    return { client, fake };
  }

  test("bg.stop, bg.respawn and bg.message answer, and an id that could be a flag is refused", async () => {
    const { client, fake } = await served();
    expect(
      (await client.data<{ sessions: unknown[] }>("bg.stop", { id: "7c5dcf5d" }))?.sessions,
    ).toHaveLength(3);
    await client.data("bg.respawn", { id: "a1b2c3d4" });
    await client.data("bg.message", { id: "7c5dcf5d", text: "oi" });
    expect(cli(fake)).toEqual([
      ["stop", "7c5dcf5d"],
      ["respawn", "a1b2c3d4"],
    ]);
    for (const id of ["--force", "a b", "x;rm", ""]) {
      const ack = (await client.request("bg.stop", { id })) as { ok: boolean };
      expect(ack.ok).toBe(false);
    }
    expect(cli(fake)).toHaveLength(2);
  });
});

describe("bg-controlar: a listed session's folder is the listing's word, so it is checked against the allowed roots (issue #415)", () => {
  const withRoots = (roots: readonly string[]) => {
    const fake = installFakeClaude([]);
    cleanups.push(fake.restore);
    fake.setAgents([RUNNING, DONE, LOST]);
    const service = new BgService({
      db: new EventStore(":memory:").db,
      claude: () => whichOnPath("claude"),
      trust: () => ({ trusted: true }),
      allowedRoots: roots,
    });
    return { fake, service };
  };

  test("message and respawn refuse a session whose folder is outside the roots, and run nothing", async () => {
    const { fake, service } = withRoots([tempDir("fd-bg-roots-")]);
    for (const run of [
      () => service.respawn("7c5dcf5d"),
      () => service.message("a1b2c3d4", "hello"),
    ]) {
      const error = await refused(run);
      expect(error.code).toBe("forbidden_cwd");
      expect(error.reason).toBe("cwd_outside_roots");
    }
    expect(cli(fake)).toEqual([]);
  });

  test("a session inside a root is continued as before", async () => {
    const root = tempDir("fd-bg-roots-");
    const { fake, service } = withRoots([root]);
    fake.setAgents([{ ...RUNNING, cwd: root }]);
    await service.respawn("7c5dcf5d");
    expect(cli(fake)).toEqual([["respawn", "7c5dcf5d"]]);
  });
});

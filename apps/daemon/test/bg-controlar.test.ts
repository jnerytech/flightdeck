import { afterEach, describe, expect, test } from "bun:test";
import { BgService } from "../src/bg/service.ts";
import { FlightdeckError } from "../src/errors.ts";
import { startServer } from "../src/server.ts";
import { EventStore } from "../src/store/event-store.ts";
import { whichOnPath } from "../src/which.ts";
import { installFakeClaude } from "./fake-claude.ts";
import { newManager } from "./helpers.ts";
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

function setup(channel?: (id: string, text: string) => boolean) {
  const fake = installFakeClaude([]);
  cleanups.push(fake.restore);
  fake.setAgents([RUNNING, DONE, LOST]);
  const service = new BgService({
    db: new EventStore(":memory:").db,
    claude: () => whichOnPath("claude"),
    ...(channel ? { channel } : {}),
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

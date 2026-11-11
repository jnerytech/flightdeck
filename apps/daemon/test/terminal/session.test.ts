import { afterEach, describe, expect, test } from "bun:test";
import { realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TerminalInfo } from "@flightdeck/protocol";
import { startDaemon } from "../src/main.ts";
import { tempDir, workspace } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";
import { fakePtys } from "./pty-helpers.ts";

const TOKEN = "terminal-session-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** A daemon on fake PTYs with a managed session in the project's folder. */
async function daemon(config: Record<string, unknown> = {}) {
  const dir = tempDir();
  const { root, project } = workspace();
  const file = join(dir, "config.json");
  writeFileSync(
    file,
    JSON.stringify({
      port: 0,
      token: TOKEN,
      dataDir: join(dir, "data"),
      allowedRoots: [root],
      history: { roots: [join(dir, "nada")] },
      ...config,
    }),
  );
  const ptys = fakePtys();
  const running = await startDaemon(
    { command: "start", config: file, runtime: "fake" },
    {},
    { log: () => {}, error: () => {} },
    { pty: ptys.factory },
  );
  cleanups.push(() => running.stop());
  const client = new FrameClient(`ws://127.0.0.1:${new URL(running.url).port}/v1/ws`);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  const created = await client.data<{ sessionId: string }>("session.create", {
    cwd: project,
    prompt: "go",
  });
  return {
    client,
    ptys,
    project,
    sessionId: created?.sessionId ?? "",
    /** `code/reason` of a refusal, or "ok". */
    refusal: async (type: string, payload: unknown) => {
      const reply = await client.request(type, payload);
      const error = reply.error as { code?: string; reason?: string } | undefined;
      return error ? `${error.code}/${error.reason ?? ""}` : "ok";
    },
  };
}

describe("terminal-sessao: a shell for a session opens in the session's own folder (issue #107)", () => {
  test("the folder comes from the daemon's record of the session, not from the app", async () => {
    const { client, ptys, project, sessionId } = await daemon();
    const opened = await client.data<TerminalInfo>("terminal.openSession", {
      session: sessionId,
      cols: 80,
      rows: 24,
    });
    expect(opened?.cwd).toBe(realpathSync.native(project));
    expect(ptys.spawned.map((pty) => pty.cwd)).toEqual([realpathSync.native(project)]);
    // The default shell, never a command of the app.
    expect(opened?.command).not.toBe("");
  });

  test("a path sent along with the session is refused, and so is a request without a session", async () => {
    const { refusal, ptys, sessionId } = await daemon();
    // The plain request works, so the refusals below are about the extra path and the missing session.
    expect(await refusal("terminal.openSession", { session: sessionId, cols: 80, rows: 24 })).toBe(
      "ok",
    );
    expect(
      await refusal("terminal.openSession", {
        session: sessionId,
        cwd: "/etc",
        cols: 80,
        rows: 24,
      }),
    ).toBe("bad_request/request_invalid");
    expect(await refusal("terminal.openSession", { cols: 80, rows: 24 })).toBe(
      "bad_request/request_invalid",
    );
    // Only the first request started a shell.
    expect(ptys.spawned).toHaveLength(1);
  });

  test("a session the host does not know is refused with its reason, and no shell starts", async () => {
    const { refusal, ptys } = await daemon();
    expect(
      await refusal("terminal.openSession", { session: "nao-existe", cols: 80, rows: 24 }),
    ).toBe("not_found/session_not_found");
    expect(ptys.spawned).toEqual([]);
  });

  test("the host announces terminal.session with the terminal, and not without it", async () => {
    const on = await daemon({ terminal: { enabled: true } });
    expect((await on.client.data<{ features: string[] }>("host.info", {}))?.features).toContain(
      "terminal.session",
    );
    const off = await daemon({ terminal: { enabled: false } });
    expect(
      (await off.client.data<{ features: string[] }>("host.info", {}))?.features,
    ).not.toContain("terminal.session");
    // A terminal that is off refuses a shell for a session as it refuses any other.
    expect(
      await off.refusal("terminal.openSession", { session: off.sessionId, cols: 80, rows: 24 }),
    ).toBe("terminal_disabled/terminal_disabled");
  });
});

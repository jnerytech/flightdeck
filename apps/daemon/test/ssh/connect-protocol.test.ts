import { afterEach, describe, expect, test } from "bun:test";
import { startServer } from "../../src/server.ts";
import { newManager, workspace } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";
import { cleanups, drainCleanups, setup } from "../support/ssh-connect.ts";

const TOKEN = "ssh-connect-token-0123456789abcdef";
afterEach(drainCleanups);

describe("ssh-connect: over the protocol", () => {
  test("pelo protocolo: ssh.connect devolve o terminal e ssh.test o resultado do teste", async () => {
    const s = setup();
    const { root } = workspace();
    const server = startServer({
      manager: newManager().manager,
      ssh: { targets: s.targets, connect: s.connector },
      terminals: s.terminals,
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
    const info = await client.data<{ terminalId: string; command: string }>("ssh.connect", {
      targetId: s.vps.id,
      cols: 100,
      rows: 30,
    });
    expect(info?.command).toBe("ssh");
    expect(s.terminals.list().map((t) => t.terminalId)).toEqual([info?.terminalId ?? ""]);
    expect(await client.data("ssh.test", { targetId: s.vps.id })).toEqual({
      ok: true,
      error: null,
    });
    const bad = await client.request("ssh.connect", {
      targetId: s.vps.id,
      cols: 100,
      rows: 30,
      extra: 1,
    });
    expect((bad.error as { code?: string } | undefined)?.code).toBe("bad_request");
  });

  test("sem o conector configurado, ssh.connect diz que está desativado", async () => {
    const { root } = workspace();
    const server = startServer({
      manager: newManager().manager,
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
    const ack = await client.request("ssh.connect", { targetId: "x", cols: 80, rows: 24 });
    expect((ack.error as { code?: string } | undefined)?.code).toBe("invalid_state");
  });
});

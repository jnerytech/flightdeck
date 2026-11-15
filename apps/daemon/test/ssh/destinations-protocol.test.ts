import { afterEach, describe, expect, test } from "bun:test";
import { startServer } from "../../src/server.ts";
import { BASELINE_FEATURES, newManager, workspace } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";
import { setup } from "../support/ssh-destinations.ts";

const TOKEN = "ssh-targets-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

describe("ssh-destinos", () => {
  test("pelo protocolo: listar, salvar, remover com confirmação; campo desconhecido (uma senha) é recusado", async () => {
    const { targets, store } = setup();
    const { root } = workspace();
    const server = startServer({
      manager: newManager().manager,
      ssh: { targets },
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
    const codeOfCall = async (type: string, payload: unknown) =>
      ((await client.request(type, payload)).error as { code?: string } | undefined)?.code ?? "ok";
    expect(await client.data("ssh.list", {})).toEqual({ targets: [] });
    const saved = await client.data<{ id: string; port: number }>("ssh.save", {
      name: "vps",
      host: "vps.example.com",
      user: "deploy",
    });
    expect(saved?.port).toBe(22);
    expect(await client.data<{ targets: unknown[] }>("ssh.list", {})).toMatchObject({
      targets: [{ id: saved?.id, name: "vps" }],
    });
    // A password is never a field of a target.
    expect(
      await codeOfCall("ssh.save", {
        name: "x",
        host: "h.example.com",
        user: "u",
        password: "hunter2",
      }),
    ).toBe("bad_request");
    expect(JSON.stringify(store.db.query("SELECT * FROM ssh_targets").all())).not.toContain(
      "hunter2",
    );
    expect(
      await codeOfCall("ssh.save", {
        name: "f",
        host: "f",
        user: "u",
        options: { forwardAgent: true },
      }),
    ).toBe("invalid_state");
    expect(
      await codeOfCall("ssh.save", {
        name: "f",
        host: "f",
        user: "u",
        options: { forwardAgent: true },
        confirm: true,
      }),
    ).toBe("ok");
    expect(await codeOfCall("ssh.remove", { id: saved?.id })).toBe("bad_request");
    expect(await codeOfCall("ssh.remove", { id: saved?.id, confirm: false })).toBe("invalid_state");
    expect(await codeOfCall("ssh.remove", { id: saved?.id, confirm: true })).toBe("ok");
    expect(await codeOfCall("ssh.remove", { id: saved?.id, confirm: true })).toBe("not_found");
  });

  test("sem o cadastro configurado, os comandos ssh dizem que está desativado", async () => {
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
    const ack = await client.request("ssh.list", {});
    expect((ack.error as { code?: string } | undefined)?.code).toBe("invalid_state");
  });

  test("host.info announces ssh only when the server has the destinos, so the app hides Conexões elsewhere", async () => {
    const featuresOf = async (withSsh: boolean) => {
      const { targets } = setup();
      const { root } = workspace();
      const server = startServer({
        manager: newManager().manager,
        ...(withSsh ? { ssh: { targets } } : {}),
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
      return (await client.data<{ features: string[] }>("host.info", {}))?.features.filter(
        (name) => !BASELINE_FEATURES.includes(name),
      );
    };
    expect(await featuresOf(true)).toEqual(["ssh"]);
    expect(await featuresOf(false)).toEqual([]);
  });
});

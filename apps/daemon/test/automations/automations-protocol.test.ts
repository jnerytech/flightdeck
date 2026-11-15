import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { startServer } from "../../src/server.ts";
import { automationsRig, NET, TOKEN } from "../support/automations.ts";
import { FrameClient } from "../support/history-helpers.ts";

setDefaultTimeout(NET * 2);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const { fake, setup } = automationsRig(cleanups);

describe("automacoes: protocol", () => {
  test("protocolo: automation.list, save, toggle, runs e remove; ligar e remover pedem confirm", async () => {
    const ctx = await setup();
    const server = startServer({
      manager: ctx.manager,
      board: ctx.board,
      automations: ctx.automations,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const saved = await client.data<{ id: string; enabled: boolean }>("automation.save", {
      projectId: ctx.project.id,
      name: "Diária",
      trigger: { type: "cron", expr: "30 9 * * 1-5", tz: "America/Sao_Paulo" },
      action: { type: "start_workflow", workflow: "wf" },
    });
    expect(saved?.enabled).toBe(false);
    const id = saved?.id ?? "";
    expect(await client.request("automation.toggle", { id, enabled: true })).toMatchObject({
      ok: false,
      error: { code: "invalid_state" },
    });
    expect(
      (
        await client.data<{ enabled: boolean }>("automation.toggle", {
          id,
          enabled: true,
          confirm: true,
        })
      )?.enabled,
    ).toBe(true);
    expect(
      (
        await client.data<{ automations: unknown[] }>("automation.list", {
          projectId: ctx.project.id,
        })
      )?.automations,
    ).toHaveLength(1);
    expect(await client.data("automation.runs", { id })).toEqual({ runs: [] });
    expect(await client.request("automation.remove", { id })).toMatchObject({ ok: false });
    expect(
      (await client.data<{ automations: unknown[] }>("automation.remove", { id, confirm: true }))
        ?.automations,
    ).toEqual([]);
    expect(
      await client.request("automation.save", {
        projectId: ctx.project.id,
        name: "Ruim",
        trigger: { type: "cron", expr: "x", tz: "UTC" },
        action: { type: "send_to_card" },
      }),
    ).toMatchObject({ ok: false, error: { code: "bad_request" } });
  });

  test("protocolo: daemon sem as automações responde invalid_state", async () => {
    const ctx = await setup();
    const server = startServer({
      manager: ctx.manager,
      board: ctx.board,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    expect(await client.request("automation.list", { projectId: ctx.project.id })).toMatchObject({
      ok: false,
      error: { code: "invalid_state" },
    });
  });
});

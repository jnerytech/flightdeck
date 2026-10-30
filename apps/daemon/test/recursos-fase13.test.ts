import { afterEach, describe, expect, test } from "bun:test";
import type { Automations } from "../src/automations/automations.ts";
import type { Issues } from "../src/issues/issues.ts";
import type { AutoApprover } from "../src/permissions/auto-approve.ts";
import { startServer } from "../src/server.ts";
import { newBoard } from "./board-helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "recursos-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** What `host.info` announces for a server built with these parts. */
async function features(parts: {
  board?: boolean;
  issues?: boolean;
  automations?: boolean;
  autoApprove?: boolean;
}) {
  const ctx = newBoard();
  cleanups.push(() => ctx.board.stop());
  const server = startServer({
    manager: ctx.manager,
    ...(parts.board ? { board: ctx.board } : {}),
    ...(parts.issues ? { issues: {} as Issues } : {}),
    ...(parts.automations ? { automations: {} as Automations } : {}),
    ...(parts.autoApprove ? { autoApprove: {} as AutoApprover } : {}),
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [ctx.root],
  });
  cleanups.push(() => server.stop());
  const client = new FrameClient(server.url);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  return (await client.data<{ features: string[] }>("host.info", {}))?.features ?? [];
}

describe("recursos-fase13: o host.info anuncia o que a Fase 13 trouxe", () => {
  test("issues e automation só quando o daemon os tem, e arena junto com o board", async () => {
    expect(await features({})).toEqual([]);
    expect(await features({ issues: true })).toEqual(["issues"]);
    expect(await features({ automations: true })).toEqual(["automation"]);
    expect(await features({ board: true })).toEqual(["workflows", "rules", "arena"]);
    expect(await features({ board: true, issues: true, automations: true })).toEqual([
      "workflows",
      "rules",
      "arena",
      "issues",
      "automation",
    ]);
  });

  test("autoapprove só quando o daemon tem a aprovação automática", async () => {
    expect(await features({})).toEqual([]);
    expect(await features({ autoApprove: true })).toEqual(["autoapprove"]);
  });
});

import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as protocol from "@flightdeck/protocol";
import { type RunningServer, startServer } from "../src/server.ts";
import { newManager, poll } from "./helpers.ts";
import { KEY, PERIOD, roiSetup } from "./roi-setup.ts";

setDefaultTimeout(30_000);

const TOKEN = "roi-protocol-token-0123456789abc";
const stops: Array<() => unknown> = [];
afterEach(async () => {
  for (const stop of stops.splice(0).reverse()) await stop();
});

async function ask(server: RunningServer, type: string, payload: object) {
  const ws = new WebSocket(server.url);
  const acks: protocol.Ack[] = [];
  ws.addEventListener("message", (m) => {
    const msg = protocol.parseServerMessage(String(m.data));
    if (msg.type === "ack") acks.push(msg);
  });
  await new Promise((r) => ws.addEventListener("open", r));
  ws.send(JSON.stringify({ id: "1", type: "hello", payload: { token: TOKEN, client: "t" } }));
  ws.send(JSON.stringify({ id: "2", type, payload }));
  const ack = await poll(() => acks.find((a) => a.id === "2"), 10_000);
  ws.close();
  return ack;
}

async function host(withRoi: boolean) {
  const s = await roiSetup();
  const server = startServer({
    manager: newManager().manager,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [s.root],
    board: s.board,
    ...(withRoi ? { roi: s.summarizer } : {}),
  });
  stops.push(() => server.stop());
  return { ...s, server };
}

describe("roi-protocolo: the commands and the new fields", () => {
  test("payloads: roi.summary takes two days and an optional key; hours are bounded", () => {
    const parse = (type: string, payload: object) =>
      protocol.Command.safeParse({ id: "1", type, payload }).success;
    expect(parse("roi.summary", { from: "2026-10-01", to: "2026-10-31" })).toBe(true);
    expect(parse("roi.summary", { from: "2026-10-01", to: "2026-10-31", projectKey: "a/b" })).toBe(
      true,
    );
    expect(parse("roi.summary", { from: "2026-10-01" })).toBe(false);
    expect(parse("roi.summary", { from: "yesterday", to: "2026-10-31" })).toBe(false);
    expect(parse("roi.summary", { from: "2026-10-01", to: "2026-10-31", rate: 60 })).toBe(false);
    expect(parse("card.update", { cardId: "c", estimateHours: 2.5 })).toBe(true);
    expect(parse("card.update", { cardId: "c", estimateHours: null })).toBe(true);
    expect(parse("card.update", { cardId: "c", estimateHours: -1 })).toBe(false);
    expect(parse("card.update", { cardId: "c", estimateHours: 5000 })).toBe(false);
    expect(parse("project.update", { projectId: "p", defaultHours: 2 })).toBe(true);
    expect(parse("project.update", { projectId: "p", defaultHours: null })).toBe(true);
    expect(parse("project.update", { projectId: "p", defaultHours: -1 })).toBe(false);
  });

  test("roi.summary answers over the socket, and host.info announces roi", async () => {
    const h = await host(true);
    h.usage("2026-10-10", 3, 100);
    h.done("a", "2026-10-09", "2026-09-01", { via: "merged" });
    const ack = await ask(h.server, "roi.summary", PERIOD);
    const result = ack?.ok ? (ack.data as protocol.RoiSummaryResult) : null;
    expect(result?.projects.find((p) => p.projectKey === KEY)?.current).toMatchObject({
      costUsd: 3,
      tokens: 100,
      cards: 1,
      prsMerged: 1,
      planned: 1,
    });
    const info = await ask(h.server, "host.info", {});
    expect(info?.ok && (info.data as { features: string[] }).features).toContain("roi");
  });

  test("a period that ends before it starts, or is over a year long, is refused with its reason", async () => {
    const h = await host(true);
    const backwards = await ask(h.server, "roi.summary", { from: "2026-10-10", to: "2026-10-01" });
    expect(backwards && !backwards.ok && backwards.error.reason).toBe("roi_period_invalid");
    const long = await ask(h.server, "roi.summary", { from: "2024-01-01", to: "2026-10-01" });
    expect(long && !long.ok && long.error.reason).toBe("roi_period_invalid");
    const impossible = await ask(h.server, "roi.summary", { from: "2026-02-31", to: "2026-03-05" });
    expect(impossible && !impossible.ok && impossible.error.reason).toBe("roi_period_invalid");
  });

  test("a host without the feature refuses it and announces nothing", async () => {
    const h = await host(false);
    const refused = await ask(h.server, "roi.summary", PERIOD);
    expect(refused && !refused.ok && refused.error.reason).toBe("feature_off");
    const info = await ask(h.server, "host.info", {});
    expect(info?.ok && (info.data as { features: string[] }).features).not.toContain("roi");
  });

  test("a card's hours and a project's default hours are saved and come back", async () => {
    const h = await host(true);
    const card = h.board.createCard(h.project.id, { title: "A card", description: "" });
    const saved = await ask(h.server, "card.update", { cardId: card.id, estimateHours: 2.5 });
    expect(saved?.ok && (saved.data as protocol.Card).estimateHours).toBe(2.5);
    expect(h.board.getCard(card.id).estimateHours).toBe(2.5);
    const cleared = await ask(h.server, "card.update", { cardId: card.id, estimateHours: null });
    expect(cleared?.ok && (cleared.data as protocol.Card).estimateHours).toBeNull();
    const project = await ask(h.server, "project.update", {
      projectId: h.project.id,
      defaultHours: 3,
    });
    expect(project?.ok && (project.data as protocol.Project).defaultHours).toBe(3);
    expect(h.board.getProject(h.project.id).defaultHours).toBe(3);
    const summary = await ask(h.server, "roi.summary", PERIOD);
    expect(summary?.ok).toBe(true);
  });
});

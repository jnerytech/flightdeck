import { expect, test } from "bun:test";
import { loadFinished, sinceLastLook } from "../../apps/desktop/src/lib/finished.ts";
import { loadInbox } from "../../apps/desktop/src/lib/inbox.ts";
import { parseRequestLink } from "../../apps/desktop/src/lib/request-link.ts";
import { demoFinished, demoInbox } from "../lib/shots-seed.ts";

const storageOf = (key: string, value: string) => ({
  getItem: (asked: string) => (asked === key ? value : null),
});

const REQUEST = { hostId: "demo-alfa", requestId: "req-42" };

test("the bell print holds one request row that points to the live request, so it can be answered", () => {
  for (const lang of ["en", "pt-BR"]) {
    const entries = loadInbox(storageOf("flightdeck.inbox", demoInbox(lang, REQUEST)));
    const linked = entries.filter((entry) => entry.link !== undefined);
    expect(linked.map((entry) => parseRequestLink(entry.link ?? ""))).toEqual([REQUEST]);
    expect(linked[0]?.ask).toContain("bun test");
  }
});

test("with no live request the bell print keeps its rows and none of them has a link", () => {
  const entries = loadInbox(storageOf("flightdeck.inbox", demoInbox("en", null)));
  expect(entries.length).toBeGreaterThan(5);
  expect(entries.some((entry) => entry.link !== undefined)).toBe(false);
});

test("the Needs you print starts with a finished turn and a failed one that nobody has looked at", () => {
  const now = new Date("2026-11-08T12:00:00.000Z");
  const json = demoFinished(
    "demo-alfa",
    {
      done: { id: "s-done", name: "Revisão do PR 128" },
      failed: { id: "s-bad", name: "Carrinho" },
    },
    now,
  );
  const state = loadFinished(storageOf("flightdeck.finished", json));
  const unseen = sinceLastLook(state.list, state.lastLook);
  expect(unseen.map((f) => [f.name, f.outcome, f.hostId, f.sessionId])).toEqual([
    ["Revisão do PR 128", "done", "demo-alfa", "s-done"],
    ["Carrinho", "failed", "demo-alfa", "s-bad"],
  ]);
  expect(unseen.every((f) => Date.parse(f.at) < now.getTime())).toBe(true);
  expect(unseen[0]?.files).toBe(3);
});

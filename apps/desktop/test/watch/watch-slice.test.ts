import { describe, expect, test } from "bun:test";
import type { Card, HostInfoResult, WatchInfo } from "@flightdeck/protocol";
import { WatchSlice } from "../../src/features/watch/index.ts";
import { translator } from "../../src/i18n/index.ts";

const t = translator("en");

const watchOf = (cardId: string, status: string, reason?: string) =>
  ({ cardId, status, reason }) as unknown as WatchInfo;
const cardOf = (id: string, over: Partial<Card> = {}) =>
  ({ id, projectId: "p1", title: `Card ${id}`, prUrl: `https://git/pr/${id}`, ...over }) as Card;
const info = (features: string[]) => ({ features }) as unknown as HostInfoResult;

/** A watch over stand-ins: the order of what it did, the watches kept and the answers of the hosts. */
function watching(
  over: {
    cards?: Card[];
    answers?: Record<string, unknown>;
    hosts?: Array<{ id: string; status?: string; features?: string[] }>;
  } = {},
) {
  const log: unknown[] = [];
  const kept = new Map<string, WatchInfo>();
  const cards = over.cards ?? [cardOf("c1")];
  const slice = new WatchSlice({
    command: async (hostId, type, payload, options) => {
      log.push({ hostId, type, payload, ...(options ? { options } : {}) });
      const answer = over.answers?.[`${hostId}/${type}`] ?? over.answers?.[type];
      return (answer ?? null) as never;
    },
    hosts: () =>
      (over.hosts ?? [{ id: "h", features: ["watch"] }]).map((h) => ({
        id: h.id,
        name: `name-${h.id}`,
        status: h.status ?? "online",
        hostInfo: info(h.features ?? ["watch"]),
      })),
    watchOf: (hostId, cardId) => kept.get(`${hostId}/${cardId}`),
    keep: (hostId, watch) => void kept.set(`${hostId}/${watch.cardId}`, watch),
    card: (_hostId, cardId) => cards.find((c) => c.id === cardId),
    feed: (host, title, before, watch) =>
      void log.push({ feed: host.name, title, before: before?.status ?? null, now: watch.status }),
    notify: (notification, route, fallbackUrl, source) =>
      void log.push({ notify: notification, route, fallbackUrl, source }),
    fail: (_error, text) => void log.push({ fail: text }),
    t: () => t,
  });
  return { slice, log, kept };
}

describe("PR watch (#1596)", () => {
  test("a watch that starts to need the person is kept, fed to the webhooks and told to the OS", () => {
    const { slice, log, kept } = watching();
    slice.keep("h", watchOf("c1", "needs_you", "CI failed"));
    expect({ kept: kept.get("h/c1")?.status, log }).toEqual({
      kept: "needs_you",
      log: [
        { feed: "name-h", title: "Card c1", before: null, now: "needs_you" },
        {
          notify: { title: t("watchUi.notifyTitle"), body: "Card c1: CI failed" },
          route: { name: "card", host: "h", projectId: "p1", cardId: "c1" },
          fallbackUrl: "https://git/pr/c1",
          source: { event: "pr-watch", hostId: "h", project: "h/p1" },
        },
      ],
    });
  });

  test("a watch that already needed the person, or that does not, tells the OS nothing", () => {
    const { slice, log } = watching();
    slice.keep("h", watchOf("c1", "needs_you", "CI failed"));
    log.length = 0;
    slice.keep("h", watchOf("c1", "needs_you", "still failing"));
    slice.keep("h", watchOf("c1", "watching"));
    expect(log.filter((l) => "notify" in (l as object))).toEqual([]);
    expect(log).toHaveLength(2);
  });

  test("a watch of a card the app does not have is told to the OS without a screen to open", () => {
    const { slice, log } = watching({ cards: [] });
    slice.keep("ghost", watchOf("c9", "needs_you"));
    expect(log).toEqual([
      { feed: "ghost", title: "c9", before: null, now: "needs_you" },
      {
        notify: { title: t("watchUi.notifyTitle"), body: "c9: " },
        route: undefined,
        fallbackUrl: undefined,
        source: { event: "pr-watch", hostId: "ghost" },
      },
    ]);
  });

  test("reading, turning on or off and giving more rounds keep what the host answers; a refusal keeps nothing", async () => {
    const answered = watching({
      answers: {
        "watch.get": watchOf("c1", "watching"),
        "watch.set": watchOf("c1", "needs_you"),
        "watch.extend": watchOf("c1", "watching"),
      },
    });
    await answered.slice.load("h", "c1");
    await answered.slice.set("h", "c1", false);
    await answered.slice.extend("h", "c1", 3);
    const refused = watching();
    await refused.slice.set("h", "c1", true);
    expect({
      sent: answered.log.filter((l) => "type" in (l as object)),
      kept: answered.kept.get("h/c1")?.status,
      refusedKept: refused.kept.size,
    }).toEqual({
      sent: [
        { hostId: "h", type: "watch.get", payload: { cardId: "c1" } },
        { hostId: "h", type: "watch.set", payload: { cardId: "c1", enabled: false } },
        {
          hostId: "h",
          type: "watch.extend",
          payload: { cardId: "c1", rounds: 3 },
          options: { retry: false },
        },
      ],
      kept: "watching",
      refusedKept: 0,
    });
  });

  test("a held round is pushed or dropped once, never repeated, and the watch it answers is kept", async () => {
    const { slice, log, kept } = watching({
      answers: { "watch.resolveHeld": watchOf("c1", "watching") },
    });
    await slice.resolveHeld("h", "c1", "r1", "drop");
    expect({ log: log[0], kept: kept.has("h/c1") }).toEqual({
      log: {
        hostId: "h",
        type: "watch.resolveHeld",
        payload: { cardId: "c1", roundId: "r1", action: "drop" },
        options: { retry: false },
      },
      kept: true,
    });
  });

  test("a project's settings go with their patch only when there is one, and a description is asked for the card", async () => {
    const { slice, log } = watching();
    await slice.settings("h", "p1");
    await slice.settings("h", "p1", { enabled: true } as never);
    await slice.describe("h", "c1");
    expect(log).toEqual([
      { hostId: "h", type: "watch.settings", payload: { projectId: "p1" } },
      {
        hostId: "h",
        type: "watch.settings",
        payload: { projectId: "p1", patch: { enabled: true } },
      },
      { hostId: "h", type: "watch.describe", payload: { cardId: "c1" } },
    ]);
  });

  test("a PR link opens the card of the first online host that watches PRs and knows it", async () => {
    const { slice, log } = watching({
      hosts: [
        { id: "off", status: "offline" },
        { id: "old", features: ["board"] },
        { id: "a" },
        { id: "b" },
      ],
      answers: {
        "a/watch.byUrl": { via: "card", trace: { cardId: "c1" }, sessions: [] },
        "a/card.get": cardOf("c1"),
      },
    });
    const route = await slice.openLink("https://git/pr/1");
    expect({ route, asked: log.map((l) => (l as { hostId: string }).hostId) }).toEqual({
      route: { name: "card", host: "a", projectId: "p1", cardId: "c1" },
      asked: ["a", "a"],
    });
  });

  test("a PR link falls back to the first session the history knows, and says so when no host knows it", async () => {
    const known = watching({
      answers: { "watch.byUrl": { via: "history", sessions: [{ claudeSessionId: "s-1" }] } },
    });
    const unknown = watching({ answers: { "watch.byUrl": { via: "none", sessions: [] } } });
    const route = await known.slice.openLink("https://git/pr/2");
    const none = await unknown.slice.openLink("https://git/pr/3");
    expect({ route, none, said: unknown.log.at(-1) }).toEqual({
      route: { name: "reader", target: { hostId: "h", claudeSessionId: "s-1" } },
      none: null,
      said: { fail: t("palette.noPrMatch") },
    });
  });
});

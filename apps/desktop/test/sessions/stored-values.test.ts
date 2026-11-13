import { describe, expect, test } from "bun:test";
import {
  loadAutoResume,
  loadHandled,
  markHandled,
  unanswered,
} from "../../src/features/sessions/domain/resume-offer.ts";
import {
  DEFAULT_HUB_FILTER,
  HUB_FILTER_KEY,
  HUB_OPEN_KEY,
  loadHubFilter,
  loadHubOpen,
  takeHubHost,
} from "../../src/features/sessions/hub.ts";

/** A storage that holds text as it is, so a test can plant a value the app never wrote. */
const planted = (items: Record<string, string>) => {
  const kept = new Map(Object.entries(items));
  return {
    kept,
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
  };
};

describe("what the sessions kept on this computer is not trusted (#1609)", () => {
  test("a resume offer's answered list drops a host whose keys are not a list of text, and keeps the others", () => {
    const storage = planted({
      "flightdeck.resumeHandled": JSON.stringify({ h1: 5, h2: ["a", 1], h3: ["k@1"], h4: "k@2" }),
    });
    expect(loadHandled(storage)).toEqual({ h3: ["k@1"] });
  });

  test("answering an offer after a damaged value keeps what is good and does not throw", () => {
    const storage = planted({
      "flightdeck.resumeHandled": JSON.stringify({ h1: 5, h2: ["old@1"] }),
    });
    expect(() => markHandled(storage, "h1", ["new@1"])).not.toThrow();
    markHandled(storage, "h2", ["new@2"]);
    expect(loadHandled(storage)).toEqual({ h1: ["new@1"], h2: ["old@1", "new@2"] });
    const offers = [
      { sessionId: "new", interruptedAt: "2" },
      { sessionId: "fresh", interruptedAt: "3" },
    ] as Parameters<typeof unanswered>[0];
    expect(unanswered(offers, loadHandled(storage).h2).map((o) => o.sessionId)).toEqual(["fresh"]);
  });

  test("the automatic setting is on only for a host stored as true", () => {
    const storage = planted({
      "flightdeck.resumeAuto": JSON.stringify({ h1: true, h2: "true", h3: 1, h4: [true] }),
    });
    expect(["h1", "h2", "h3", "h4"].map((host) => loadAutoResume(storage, host))).toEqual([
      true,
      false,
      false,
      false,
    ]);
    expect(loadAutoResume(planted({ "flightdeck.resumeAuto": "[true]" }), "0")).toBe(false);
  });

  test("the hub's filters fall back field by field: a value of the wrong kind or an unknown choice is the default", () => {
    const storage = planted({
      [HUB_FILTER_KEY]: JSON.stringify({
        origin: "elsewhere",
        state: 7,
        persona: ["qa"],
        pinnedOnly: "yes",
        showArchived: true,
      }),
    });
    expect(loadHubFilter(storage)).toEqual({ ...DEFAULT_HUB_FILTER, showArchived: true });
    for (const bad of ["null", "[1]", "7", '"text"', "{not json", ""]) {
      expect(loadHubFilter(planted({ [HUB_FILTER_KEY]: bad }))).toEqual(DEFAULT_HUB_FILTER);
    }
    expect(loadHubFilter(planted({ [HUB_FILTER_KEY]: '{"origin":"terminal"}' })).origin).toBe(
      "terminal",
    );
  });

  test("an old host kept in the hub's filter is taken once; a host that is not text is no host", () => {
    expect(takeHubHost(planted({ [HUB_FILTER_KEY]: '{"host":42}' }))).toBe("");
    expect(takeHubHost(planted({ [HUB_FILTER_KEY]: "[1]" }))).toBe("");
    const storage = planted({ [HUB_FILTER_KEY]: '{"host":"beta","state":"idle"}' });
    expect(takeHubHost(storage)).toBe("beta");
    expect(loadHubFilter(storage).state).toBe("idle");
    expect(takeHubHost(storage)).toBe("");
  });

  test("the projects the hub kept open are the booleans in a stored object, and nothing else", () => {
    const storage = planted({
      [HUB_OPEN_KEY]: JSON.stringify({ a: true, b: false, c: "true", d: 1, e: null }),
    });
    expect(loadHubOpen(storage)).toEqual({ a: true, b: false });
    for (const bad of ["[true]", "null", "3", "{oops", ""]) {
      expect(loadHubOpen(planted({ [HUB_OPEN_KEY]: bad }))).toEqual({});
    }
  });
});

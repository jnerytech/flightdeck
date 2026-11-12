import { describe, expect, test } from "bun:test";
import { DEFAULT_HUB_FILTER } from "../../src/features/sessions/hub.ts";
import {
  costAsks,
  cursorMove,
  filterCount,
  hasBackgroundHost,
  hostlessHub,
  personasOf,
  refreshSignature,
  rowOffers,
  rowSummary,
  showsStateWord,
  worktreesOf,
} from "../../src/features/sessions/hub-derive.ts";

describe("worktreesOf", () => {
  const cards = {
    "h1/c1": { projectId: "p1", worktreePath: "/w/a" },
    "h1/c2": { projectId: "p1", worktreePath: null },
    "h1/c3": { projectId: "p2", worktreePath: "/w/other-project" },
    "h2/c1": { projectId: "p1", worktreePath: "/w/other-host" },
    "h1x/c1": { projectId: "p1", worktreePath: "/w/prefix-only" },
  };

  test("the checkouts of the picked project on the picked host, none for a card without one", () => {
    expect(worktreesOf(cards, { hostId: "h1", projectId: "p1" })).toEqual(["/w/a"]);
  });

  test("nothing picked, no checkouts", () => {
    expect(worktreesOf(cards, null)).toEqual([]);
  });
});

describe("personasOf", () => {
  const persona = (id: string) => ({ id, name: id, emoji: "" }) as never;

  test("each persona once, in the order it first appears, rows without one skipped", () => {
    const rows = [
      { persona: persona("dev") },
      { persona: null },
      { persona: persona("qa") },
      { persona: persona("dev") },
    ];
    expect(personasOf(rows).map((p) => (p as { id: string }).id)).toEqual(["dev", "qa"]);
  });

  test("no rows, no personas", () => {
    expect(personasOf([])).toEqual([]);
  });
});

describe("cursorMove", () => {
  test("J goes down and stops at the last row, K goes up and stops at the first", () => {
    expect(cursorMove("j", -1, 3)).toBe(0);
    expect(cursorMove("j", 1, 3)).toBe(2);
    expect(cursorMove("j", 2, 3)).toBe(2);
    expect(cursorMove("k", 2, 3)).toBe(1);
    expect(cursorMove("k", 0, 3)).toBe(0);
    expect(cursorMove("k", -1, 3)).toBe(0);
  });

  test("any other key leaves the cursor alone", () => {
    expect(cursorMove("Enter", 1, 3)).toBeNull();
    expect(cursorMove("J", 1, 3)).toBeNull();
  });
});

describe("costAsks", () => {
  const host = (id: string, status: string, features?: string[]) => ({
    id,
    status,
    sessions: [],
    hostInfo: features ? { features } : null,
  });
  const row = (hostId: string, claudeSessionId: string | null) => ({ hostId, claudeSessionId });

  test("asks only online hosts that offer costs, for the rows with a Claude session id", () => {
    const hosts = [
      host("a", "online", ["costs"]),
      host("b", "offline", ["costs"]),
      host("c", "online", ["bg"]),
      host("d", "online"),
    ];
    const rows = [row("a", "s1"), row("a", null), row("a", "s2"), row("b", "s3"), row("c", "s4")];
    expect(costAsks(hosts, rows)).toEqual([["a", ["s1", "s2"]]]);
  });

  test("an online host with costs and no rows is asked for none", () => {
    expect(costAsks([host("a", "online", ["costs"])], [])).toEqual([["a", []]]);
  });
});

describe("refreshSignature", () => {
  const host = (id: string, status: string, sessions: number, info: boolean) => ({
    id,
    status,
    sessions: new Array(sessions).fill(0),
    hostInfo: info ? {} : null,
  });

  test("only being online counts, not which way a failing host flips", () => {
    const a = refreshSignature([host("h", "connecting", 1, false)]);
    const b = refreshSignature([host("h", "offline", 1, false)]);
    expect(a).toBe(b);
    expect(refreshSignature([host("h", "online", 1, false)])).not.toBe(a);
  });

  test("a changed session count or a host that now says what it offers changes it", () => {
    const base = refreshSignature([host("h", "online", 1, false)]);
    expect(refreshSignature([host("h", "online", 2, false)])).not.toBe(base);
    expect(refreshSignature([host("h", "online", 1, true)])).not.toBe(base);
  });

  test("no hosts, an empty signature", () => {
    expect(refreshSignature([])).toBe("");
  });
});

describe("rowOffers", () => {
  const idle = { origin: "flightdeck", state: "idle", asleep: false, sessionId: "s1" } as const;
  const on = { teleportPreview: true, canTeleport: () => true };

  test("an idle managed session can be put to sleep and moved", () => {
    expect(rowOffers(idle, on)).toEqual({ sleep: true, teleport: true });
  });

  test("a sleeping, running or unmanaged session cannot be put to sleep", () => {
    expect(rowOffers({ ...idle, asleep: true }, on).sleep).toBe(false);
    expect(rowOffers({ ...idle, state: "running" }, on)).toEqual({ sleep: false, teleport: false });
    expect(rowOffers({ ...idle, origin: "terminal" }, on)).toEqual({
      sleep: false,
      teleport: false,
    });
    expect(rowOffers({ ...idle, sessionId: null }, on)).toEqual({ sleep: false, teleport: false });
  });

  test("a sleeping idle session can still be moved", () => {
    expect(rowOffers({ ...idle, asleep: true }, on).teleport).toBe(true);
  });

  test("the host is asked only for a session that could be moved", () => {
    const asked: string[] = [];
    const ask = () => {
      asked.push("h");
      return true;
    };
    rowOffers({ ...idle, state: "running" }, { teleportPreview: true, canTeleport: ask });
    rowOffers(idle, { teleportPreview: false, canTeleport: ask });
    expect(asked).toEqual([]);
    rowOffers(idle, { teleportPreview: true, canTeleport: ask });
    expect(asked).toEqual(["h"]);
  });

  test("the move needs the preview on and a host that can do it", () => {
    expect(rowOffers(idle, { teleportPreview: false, canTeleport: () => true }).teleport).toBe(
      false,
    );
    expect(rowOffers(idle, { teleportPreview: true, canTeleport: () => false }).teleport).toBe(
      false,
    );
  });
});

describe("filterCount", () => {
  test("the default filter narrows nothing, and the typed text is not counted", () => {
    expect(filterCount(DEFAULT_HUB_FILTER)).toBe(0);
    expect(filterCount({ ...DEFAULT_HUB_FILTER, text: "fix" })).toBe(0);
  });

  test("each of the five other filters adds one", () => {
    expect(
      filterCount({
        text: "",
        origin: "terminal",
        state: "idle",
        persona: "dev",
        pinnedOnly: true,
        showArchived: true,
      }),
    ).toBe(5);
    expect(filterCount({ ...DEFAULT_HUB_FILTER, pinnedOnly: true })).toBe(1);
  });
});

describe("hasBackgroundHost", () => {
  const host = (status: string, features?: string[]) => ({
    id: "h",
    status,
    sessions: [],
    hostInfo: features ? { features } : null,
  });

  test("an online host that announces background sessions", () => {
    expect(hasBackgroundHost([host("offline", ["bg"]), host("online", ["bg"])])).toBe(true);
  });

  test("not an offline one, one without the feature, one that announced nothing, or no host", () => {
    expect(hasBackgroundHost([host("offline", ["bg"])])).toBe(false);
    expect(hasBackgroundHost([host("online", ["teams"])])).toBe(false);
    expect(hasBackgroundHost([host("online")])).toBe(false);
    expect(hasBackgroundHost([])).toBe(false);
  });
});

describe("hostlessHub", () => {
  test("no host at all is a dead end, rows or not", () => {
    expect(hostlessHub([], 0)).toBe(true);
    expect(hostlessHub([], 3)).toBe(true);
  });

  test("hosts that are all down are a dead end only when nothing is cached to list", () => {
    expect(hostlessHub([{ status: "offline" }], 0)).toBe(true);
    expect(hostlessHub([{ status: "offline" }], 2)).toBe(false);
  });

  test("an online host is never one", () => {
    expect(hostlessHub([{ status: "offline" }, { status: "online" }], 0)).toBe(false);
  });
});

describe("showsStateWord", () => {
  test("a working or waiting row of the compact list shows the word", () => {
    expect(showsStateWord("compact", { origin: "flightdeck", state: "running" })).toBe(true);
    expect(showsStateWord("compact", { origin: "terminal", state: "needs_you" })).toBe(true);
    expect(showsStateWord("compact", { origin: "background", state: "running" })).toBe(true);
  });

  test("an idle or past row keeps its time, a history row never has the word", () => {
    expect(showsStateWord("compact", { origin: "flightdeck", state: "idle" })).toBe(false);
    expect(showsStateWord("compact", { origin: "flightdeck", state: "ended" })).toBe(false);
    expect(showsStateWord("compact", { origin: "history", state: "running" })).toBe(false);
  });

  test("the comfortable list has room for the time and the word, so it shows no extra one", () => {
    expect(showsStateWord("comfortable", { origin: "flightdeck", state: "running" })).toBe(false);
  });
});

describe("rowSummary", () => {
  test("the word and its detail, then the line, each part joined as the row reads", () => {
    expect(rowSummary({ word: "Running", detail: "Bash" }, "editing a.ts")).toBe(
      "Running · Bash — editing a.ts",
    );
  });

  test("a part that is empty leaves no separator behind", () => {
    expect(rowSummary({ word: "Running", detail: "" }, "editing a.ts")).toBe(
      "Running — editing a.ts",
    );
    expect(rowSummary({ word: "Running", detail: "Bash" }, "")).toBe("Running · Bash");
    expect(rowSummary({ word: "", detail: "" }, "")).toBe("");
  });
});

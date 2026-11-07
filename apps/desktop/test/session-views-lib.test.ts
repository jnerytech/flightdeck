import { describe, expect, test } from "bun:test";
import {
  type OfferedFlags,
  offeredViews,
  SESSION_VIEWS,
  type SessionView,
  SessionViews,
  tabKeyIndex,
  terminalLaunch,
  terminalSourceOf,
  type ViewKey,
  viewKeyTarget,
} from "../src/lib/session-views.ts";

describe("session-views-lib: the views of the page on screen (issue #107)", () => {
  test("the views are numbered in a fixed order, conversation first", () => {
    expect([...SESSION_VIEWS]).toEqual([
      "conversation",
      "changes",
      "files",
      "time",
      "trace",
      "messages",
      "terminal",
    ]);
  });

  test("a tab remembers its last view, and a tab that never chose has none", () => {
    const views = new SessionViews();
    expect(views.last("pc/a")).toBeNull();
    views.remember("pc/a", "changes");
    views.remember("pc/b", "trace");
    expect([views.last("pc/a"), views.last("pc/b"), views.last("pc/c")]).toEqual([
      "changes",
      "trace",
      null,
    ]);
  });

  test("a tab keeps the shell it opened, so a page that comes back finds it, until it is cleared", () => {
    const views = new SessionViews();
    expect(views.terminalOf("pc/a")).toBeNull();
    views.setTerminal("pc/a", "t-1");
    views.setTerminal("pc/b", "t-2");
    expect([views.terminalOf("pc/a"), views.terminalOf("pc/b")]).toEqual(["t-1", "t-2"]);
    views.setTerminal("pc/a", null);
    expect([views.terminalOf("pc/a"), views.terminalOf("pc/b")]).toEqual([null, "t-2"]);
  });

  test("the page on screen offers its views and takes a switch; a view it lacks is refused", () => {
    const views = new SessionViews();
    const shown: SessionView[] = [];
    expect([views.available(), views.select("changes")]).toEqual([[], false]);
    views.register({
      key: "pc/a",
      views: ["conversation", "changes"],
      select: (view) => shown.push(view),
    });
    expect(views.available()).toEqual(["conversation", "changes"]);
    expect(views.select("changes")).toBe(true);
    expect(views.select("trace")).toBe(false);
    expect(shown).toEqual(["changes"]);
  });

  test("leaving the screen takes the page off, but only the page that is still the one", () => {
    const views = new SessionViews();
    const first = views.register({ key: "pc/a", views: ["conversation"], select: () => {} });
    const leaveSecond = views.register({
      key: "pc/b",
      views: ["conversation", "files"],
      select: () => {},
    });
    // The first page left after the second arrived: the second is still on screen.
    first();
    expect(views.available()).toEqual(["conversation", "files"]);
    leaveSecond();
    expect(views.available()).toEqual([]);
  });
});

const flags = (over: Partial<OfferedFlags> = {}): OfferedFlags => ({
  enabled: false,
  files: undefined,
  telemetry: undefined,
  trace: undefined,
  claudeSessionId: undefined,
  messagingId: undefined,
  terminal: undefined,
  launched: null,
  ...over,
});

describe("sonar-sessiontabs: which views a page offers (issue #363)", () => {
  test("a page with nothing announced offers only the conversation", () => {
    expect(offeredViews(flags())).toEqual(["conversation"]);
    expect(
      offeredViews(flags({ enabled: true, files: true, telemetry: true, trace: true })),
    ).toEqual(["conversation"]);
  });

  test("a named session offers each view its host announces, in the fixed order", () => {
    const all = flags({
      enabled: true,
      files: true,
      telemetry: true,
      trace: true,
      claudeSessionId: "c",
      messagingId: "m",
      terminal: { session: "s" },
    });
    expect(offeredViews(all)).toEqual([...SESSION_VIEWS]);
    expect(offeredViews({ ...all, enabled: false })).not.toContain("changes");
    expect(offeredViews({ ...all, files: false })).not.toContain("files");
    expect(offeredViews({ ...all, telemetry: undefined })).not.toContain("time");
    expect(offeredViews({ ...all, trace: false })).not.toContain("trace");
    expect(offeredViews({ ...all, claudeSessionId: null })).toEqual([
      "conversation",
      "messages",
      "terminal",
    ]);
  });

  test("messages needs only the messaging id, an empty one or none hides it", () => {
    expect(offeredViews(flags({ messagingId: "m" }))).toEqual(["conversation", "messages"]);
    expect(offeredViews(flags({ messagingId: "" }))).toEqual(["conversation"]);
    expect(offeredViews(flags({ messagingId: null }))).toEqual(["conversation"]);
  });

  test("a managed session's shell is offered at once, a launch's terminal only once it is found", () => {
    expect(offeredViews(flags({ terminal: { session: "s" } }))).toContain("terminal");
    expect(offeredViews(flags({ terminal: { launch: "l" } }))).not.toContain("terminal");
    expect(offeredViews(flags({ terminal: { launch: "l" }, launched: "t1" }))).toContain(
      "terminal",
    );
    expect(offeredViews(flags({ launched: "t1" }))).not.toContain("terminal");
  });
});

describe("sonar-sessiontabs: the terminal a page follows (issue #363)", () => {
  test("only a launch has a launch to follow", () => {
    expect(terminalLaunch({ launch: "l1" })).toBe("l1");
    expect(terminalLaunch({ launch: null })).toBeNull();
    expect(terminalLaunch({ session: "s" })).toBeNull();
    expect(terminalLaunch(undefined)).toBeNull();
  });

  test("a session's shell wins, a launch shows its terminal once found, otherwise there is none", () => {
    expect(terminalSourceOf({ session: "s" }, "t1")).toEqual({ session: "s" });
    expect(terminalSourceOf({ launch: "l" }, "t1")).toEqual({ terminalId: "t1" });
    expect(terminalSourceOf({ launch: "l" }, null)).toBeNull();
    expect(terminalSourceOf(undefined, "t1")).toEqual({ terminalId: "t1" });
    expect(terminalSourceOf(undefined, null)).toBeNull();
  });
});

const keyEvent = (over: Partial<ViewKey>): ViewKey => ({
  key: "",
  code: "",
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...over,
});
const ALL = [...SESSION_VIEWS];

describe("sonar-sessiontabs: the view a key asks for (issue #363)", () => {
  test("Alt plus a digit asks for that view, by the physical key first and the typed digit after", () => {
    expect(viewKeyTarget(keyEvent({ altKey: true, key: "3" }), ALL, "conversation")).toBe("files");
    expect(viewKeyTarget(keyEvent({ altKey: true, key: "¡", code: "Digit1" }), ALL, "files")).toBe(
      "conversation",
    );
    expect(viewKeyTarget(keyEvent({ altKey: true, key: "2", code: "Digit7" }), ALL, "files")).toBe(
      "terminal",
    );
  });

  test("a digit with no view, or a key that is no digit, asks for nothing", () => {
    expect(
      viewKeyTarget(keyEvent({ altKey: true, key: "7" }), ALL.slice(0, 3), "files"),
    ).toBeNull();
    expect(viewKeyTarget(keyEvent({ altKey: true, key: "0" }), ALL, "files")).toBeNull();
    expect(viewKeyTarget(keyEvent({ altKey: true, key: "a" }), ALL, "files")).toBeNull();
    expect(viewKeyTarget(keyEvent({ altKey: true, key: "12" }), ALL, "files")).toBeNull();
  });

  test("Alt with another modifier, or a digit without Alt, asks for nothing", () => {
    for (const mod of ["ctrlKey", "metaKey", "shiftKey"] as const) {
      expect(
        viewKeyTarget(keyEvent({ altKey: true, key: "2", [mod]: true }), ALL, "files"),
      ).toBeNull();
    }
    expect(viewKeyTarget(keyEvent({ key: "2" }), ALL, "files")).toBeNull();
    expect(viewKeyTarget(keyEvent({ ctrlKey: true, key: "2" }), ALL, "files")).toBeNull();
  });

  test("Ctrl+` flips between the terminal and the conversation, only when there is a terminal", () => {
    const tick = keyEvent({ ctrlKey: true, key: "`" });
    expect(viewKeyTarget(tick, ALL, "conversation")).toBe("terminal");
    expect(viewKeyTarget(tick, ALL, "files")).toBe("terminal");
    expect(viewKeyTarget(tick, ALL, "terminal")).toBe("conversation");
    expect(viewKeyTarget(tick, ALL.slice(0, 6), "conversation")).toBeNull();
    expect(viewKeyTarget(keyEvent({ ctrlKey: true, key: "a" }), ALL, "conversation")).toBeNull();
    expect(
      viewKeyTarget(keyEvent({ ctrlKey: true, shiftKey: true, key: "`" }), ALL, "conversation"),
    ).toBeNull();
  });
});

describe("sonar-sessiontabs: where an arrow key moves the tab bar (issue #363)", () => {
  test("the arrows step one tab and wrap around the ends", () => {
    expect(tabKeyIndex("ArrowRight", 0, 4)).toBe(1);
    expect(tabKeyIndex("ArrowRight", 3, 4)).toBe(0);
    expect(tabKeyIndex("ArrowLeft", 2, 4)).toBe(1);
    expect(tabKeyIndex("ArrowLeft", 0, 4)).toBe(3);
  });

  test("Home goes to the first tab, End to the last, any other key to none", () => {
    expect(tabKeyIndex("Home", 2, 4)).toBe(0);
    expect(tabKeyIndex("End", 1, 4)).toBe(3);
    expect(tabKeyIndex("a", 1, 4)).toBe(-1);
    expect(tabKeyIndex("ArrowUp", 1, 4)).toBe(-1);
  });
});

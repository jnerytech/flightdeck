import { describe, expect, test } from "bun:test";
import { SESSION_VIEWS, type SessionView, SessionViews } from "../src/lib/session-views.ts";

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

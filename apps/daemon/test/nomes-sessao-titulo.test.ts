import { describe, expect, test } from "bun:test";
import { Names } from "../src/names/names.ts";
import { adoptTitles } from "../src/names/track.ts";
import { EventStore } from "../src/store/event-store.ts";

const setup = () => {
  const store = new EventStore(":memory:");
  const names = new Names(store.db);
  names.assign("s1", { project: "flightdeck" });
  return { names, store };
};

describe("nomes-sessao-titulo: the name a session has in Claude Code (issue #605)", () => {
  test("a custom-title becomes the display name, and its slug is an alias next to the old one", () => {
    const { names } = setup();
    names.adoptTitle("s1", "fd-coordinator", "custom");
    const name = names.get("s1");
    expect(name?.display).toBe("fd-coordinator");
    expect(name?.aliases).toEqual(["flightdeck-geral-1", "fd-coordinator"]);
    expect(names.resolve("flightdeck-geral-1")).toBe("s1");
    expect(names.resolve("fd-coordinator")).toBe("s1");
  });

  test("the last custom-title wins, and the earlier alias keeps working", () => {
    const { names } = setup();
    names.adoptTitle("s1", "fd-coordinator", "custom");
    names.adoptTitle("s1", "fd-frontend", "custom");
    expect(names.get("s1")?.display).toBe("fd-frontend");
    expect(names.resolve("fd-coordinator")).toBe("s1");
    expect(names.resolve("fd-frontend")).toBe("s1");
  });

  test("an agent-name is the name when there is no custom-title, and never replaces one", () => {
    const { names } = setup();
    names.adoptTitle("s1", "fd-qa", "agent");
    expect(names.get("s1")?.display).toBe("fd-qa");
    names.adoptTitle("s1", "fd-coordinator", "custom");
    names.adoptTitle("s1", "fd-other", "agent");
    expect(names.get("s1")?.display).toBe("fd-coordinator");
  });

  test("a session with no title keeps its standard name, and a blank title is no title", () => {
    const { names } = setup();
    names.adoptTitle("s1", "   ", "custom");
    expect(names.get("s1")?.display).toBe("flightdeck · geral · 1");
    names.adoptTitle("never-named", "fd-qa", "custom");
    expect(names.get("never-named")).toBeNull();
  });

  test("a Flightdeck rename is not overwritten when the same title is read again", () => {
    const { names } = setup();
    names.adoptTitle("s1", "fd-coordinator", "custom");
    names.rename("s1", "the boss");
    names.adoptTitle("s1", "fd-coordinator", "custom");
    expect(names.get("s1")?.display).toBe("the boss");
  });

  test("a rename in Claude Code made after that wins over a Flightdeck rename", () => {
    const { names } = setup();
    names.adoptTitle("s1", "fd-coordinator", "custom");
    names.rename("s1", "the boss");
    names.adoptTitle("s1", "fd-architect", "custom");
    expect(names.get("s1")?.display).toBe("fd-architect");
  });

  test("a title read for the first time does not overwrite a name the person already gave", () => {
    const { names } = setup();
    names.rename("s1", "the boss");
    names.adoptTitle("s1", "fd-coordinator", "custom");
    expect(names.get("s1")?.display).toBe("the boss");
    names.adoptTitle("s1", "fd-coordinator", "custom");
    expect(names.get("s1")?.display).toBe("the boss");
  });

  test("a title that was read before the session was named is its name once it is", () => {
    const store = new EventStore(":memory:");
    const names = new Names(store.db);
    names.adoptTitle("late", "fd-quality", "custom");
    expect(names.get("late")).toBeNull();
    const name = names.assign("late", { project: "flightdeck" });
    expect(name.display).toBe("fd-quality");
    expect(name.aliases).toEqual(["flightdeck-geral-1", "fd-quality"]);
  });

  test("an alias that another session has stays with it; the display name still follows the title", () => {
    const { names } = setup();
    names.assign("s2", { project: "flightdeck" });
    names.adoptTitle("s1", "fd-qa", "custom");
    names.adoptTitle("s2", "fd-qa", "custom");
    expect(names.get("s2")?.display).toBe("fd-qa");
    expect(names.resolve("fd-qa")).toBe("s1");
    expect(names.get("s2")?.aliases).toEqual(["flightdeck-geral-2"]);
  });
});

describe("nomes-sessao-titulo: what the history indexer hands to Names (issue #605)", () => {
  const sessions = [{ id: "fd-1", claudeSessionId: "claude-1" }];

  test("a terminal session is named by its Claude id", () => {
    const { names } = setup();
    adoptTitles(names, { list: () => [] as never })("s1", "fd-qa", "custom");
    expect(names.get("s1")?.display).toBe("fd-qa");
  });

  test("a session Flightdeck started is named by its own id, not by the Claude one", () => {
    const { names } = setup();
    names.assign("fd-1", { project: "flightdeck" });
    adoptTitles(names, { list: () => sessions as never })("claude-1", "fd-qa", "custom");
    expect(names.get("fd-1")?.display).toBe("fd-qa");
    expect(names.get("claude-1")).toBeNull();
  });
});

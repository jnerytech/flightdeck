import { describe, expect, test } from "bun:test";
import { appendFileSync } from "node:fs";
import { HistoryIndexer } from "../src/history/indexer.ts";
import { lastTitle, parseLine, parseLines } from "../src/history/parser.ts";
import { Names } from "../src/names/names.ts";
import { EventStore } from "../src/store/event-store.ts";
import { projectsRoot, userLine, writeTranscript } from "./history-helpers.ts";

const CWD = "/home/dev/app";
const ID = "11111111-0000-4000-8000-000000000000";
const custom = (name: unknown) =>
  JSON.stringify({ type: "custom-title", customTitle: name, sessionId: ID });
const agent = (name: unknown) =>
  JSON.stringify({ type: "agent-name", agentName: name, sessionId: ID });

type Seen = Array<[string, string, string]>;

async function indexer(lines: string[], excludeCwds: string[] = []) {
  const root = projectsRoot();
  const path = writeTranscript(root, "-app", ID, lines);
  const seen: Seen = [];
  const index = new HistoryIndexer({
    db: new EventStore(":memory:").db,
    roots: [root],
    excludeCwds,
    onTitle: (id, title, kind) => void seen.push([id, title, kind]),
  });
  await index.scanAsync();
  return { index, path, seen };
}

describe("historico-nome-claude: the name Claude Code writes into a transcript (issue #605)", () => {
  test("a custom-title and an agent-name line carry their name; a blank or odd one carries none", () => {
    expect(parseLine(custom("fd-coordinator"))?.title).toEqual({
      kind: "custom",
      name: "fd-coordinator",
    });
    expect(parseLine(agent("fd-qa"))?.title).toEqual({ kind: "agent", name: "fd-qa" });
    expect(parseLine(custom("   "))?.title).toBeUndefined();
    expect(parseLine(custom(42))?.title).toBeUndefined();
    expect(parseLine(agent(null))?.title).toBeUndefined();
    expect(parseLine(userLine({ uuid: "u", text: "hi", cwd: CWD }))?.title).toBeUndefined();
  });

  test("the title of a run of lines is its last custom-title, else its last agent-name", () => {
    const of = (...lines: string[]) => lastTitle(parseLines(lines.join("\n")).records);
    expect(of(custom("one"), custom("two"))).toEqual({ kind: "custom", name: "two" });
    expect(of(agent("a"), custom("c"), agent("b"))).toEqual({ kind: "custom", name: "c" });
    expect(of(agent("a"), agent("b"))).toEqual({ kind: "agent", name: "b" });
    expect(of(userLine({ uuid: "u", text: "hi", cwd: CWD }))).toBeNull();
    expect(of()).toBeNull();
  });

  test("the indexer reports the title of a transcript once, and the one a later /rename adds", async () => {
    const { index, path, seen } = await indexer([
      userLine({ uuid: "u1", text: "hi", cwd: CWD }),
      custom("fd-coordinator"),
      custom("fd-frontend"),
    ]);
    expect(seen).toEqual([[ID, "fd-frontend", "custom"]]);
    await index.scanAsync();
    expect(seen).toHaveLength(1);
    appendFileSync(path, `${custom("fd-architect")}\n`);
    await index.scanAsync();
    expect(seen).toEqual([
      [ID, "fd-frontend", "custom"],
      [ID, "fd-architect", "custom"],
    ]);
  });

  test("an agent-name alone is reported as one; a transcript with neither reports nothing", async () => {
    const named = await indexer([userLine({ uuid: "u1", text: "hi", cwd: CWD }), agent("fd-qa")]);
    expect(named.seen).toEqual([[ID, "fd-qa", "agent"]]);
    const plain = await indexer([userLine({ uuid: "u1", text: "hi", cwd: CWD })]);
    expect(plain.seen).toEqual([]);
  });

  test("a session in an excluded folder is not reported", async () => {
    const { seen } = await indexer(
      [userLine({ uuid: "u1", text: "hi", cwd: CWD }), custom("fd-coordinator")],
      [CWD],
    );
    expect(seen).toEqual([]);
  });

  test("with Names: the display name follows the transcript, and a Flightdeck rename is not undone by a pass", async () => {
    const root = projectsRoot();
    const path = writeTranscript(root, "-app", ID, [
      userLine({ uuid: "u1", text: "hi", cwd: CWD }),
      custom("fd-coordinator"),
    ]);
    const store = new EventStore(":memory:");
    const names = new Names(store.db);
    names.assign(ID, { project: "flightdeck" });
    const index = new HistoryIndexer({
      db: store.db,
      roots: [root],
      onTitle: (id, title, kind) => names.adoptTitle(id, title, kind),
    });
    await index.scanAsync();
    expect(names.get(ID)?.display).toBe("fd-coordinator");
    names.rename(ID, "the boss");
    appendFileSync(path, `${userLine({ uuid: "u2", text: "more", cwd: CWD })}\n`);
    await index.scanAsync();
    expect(names.get(ID)?.display).toBe("the boss");
    appendFileSync(path, `${custom("fd-architect")}\n`);
    await index.scanAsync();
    expect(names.get(ID)?.display).toBe("fd-architect");
  });
});

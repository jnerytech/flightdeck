import { describe, expect, test } from "bun:test";
import { Command } from "@flightdeck/protocol";
import { HistoryIndexer } from "../src/history/indexer.ts";
import { EventStore } from "../src/store/event-store.ts";
import { tempDir } from "./helpers.ts";
import { assistantLine, projectsRoot, userLine, writeTranscript } from "./history-helpers.ts";

const HOME_CWD = "/home/dev/app";
const ID = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;

/** A transcript whose lines carry the `entrypoint` Claude Code writes (absent in old ones). */
function session(root: string, n: number, cwd: string, entrypoint?: string) {
  const extra = entrypoint === undefined ? {} : { entrypoint };
  const lines = [
    userLine({ uuid: `u${n}`, text: `pedido ${n}`, cwd }),
    assistantLine({ uuid: `a${n}`, text: "ok", cwd }),
  ];
  writeTranscript(
    root,
    `-p${n}`,
    ID(n),
    lines.map((l) => JSON.stringify({ ...JSON.parse(l), ...extra })),
  );
}

async function indexed(build: (root: string) => void) {
  const root = projectsRoot();
  build(root);
  const index = new HistoryIndexer({ db: new EventStore(":memory:").db, roots: [root] });
  await index.scanAsync();
  return index;
}

const flags = (index: HistoryIndexer) =>
  Object.fromEntries(index.list({}).sessions.map((s) => [s.claudeSessionId, s.automated]));

describe("historico-automatizadas: the runs nobody typed", () => {
  test("a print-mode run (an sdk entrypoint) is automated; an interactive or an old transcript is not", async () => {
    const index = await indexed((root) => {
      session(root, 1, HOME_CWD, "sdk-cli");
      session(root, 2, HOME_CWD, "sdk-ts");
      session(root, 3, HOME_CWD, "cli");
      session(root, 4, HOME_CWD);
    });
    expect(flags(index)).toEqual({ [ID(1)]: true, [ID(2)]: true, [ID(3)]: false, [ID(4)]: false });
  });

  test("a session in a temp folder is automated, whatever the system's slash or case", async () => {
    const index = await indexed((root) => {
      session(root, 1, "C:\\Users\\dev\\AppData\\Local\\Temp\\claude\\x\\work\\proj", "cli");
      session(root, 2, "/tmp/e2e/proj", "cli");
      session(root, 3, "/var/folders/ab/cd/T/proj", "cli");
      session(root, 4, "D:\\TEMP\\x", "cli");
      session(root, 5, "/home/dev/tmp-notes", "cli");
      session(root, 6, "/home/dev/temporal", "cli");
    });
    expect(flags(index)).toEqual({
      [ID(1)]: true,
      [ID(2)]: true,
      [ID(3)]: true,
      [ID(4)]: true,
      [ID(5)]: false,
      [ID(6)]: false,
    });
  });

  test("hideAutomated leaves them out and counts how many it left out", async () => {
    const index = await indexed((root) => {
      session(root, 1, HOME_CWD, "sdk-cli");
      session(root, 2, "/tmp/e2e/proj", "cli");
      session(root, 3, HOME_CWD, "cli");
    });
    const shown = index.list({ hideAutomated: true });
    expect(shown.sessions.map((s) => s.claudeSessionId)).toEqual([ID(3)]);
    expect(shown.automatedCount).toBe(2);
    // Not asked to hide: all of them, and the count is still there.
    const all = index.list({});
    expect(all.sessions).toHaveLength(3);
    expect(all.automatedCount).toBe(2);
  });

  test("the command takes hideAutomated", () => {
    expect(
      Command.safeParse({ id: "1", type: "history.list", payload: { hideAutomated: true } })
        .success,
    ).toBe(true);
  });
});

describe("historico-automatizadas: the folder of a session", () => {
  test("a transcript says whether its folder is still on the host", async () => {
    const here = tempDir("fd-cwd-");
    const index = await indexed((root) => {
      session(root, 1, here, "cli");
      session(root, 2, `${here}/gone`, "cli");
    });
    expect((await index.get(ID(1))).cwdExists).toBe(true);
    expect((await index.get(ID(2))).cwdExists).toBe(false);
  });
});

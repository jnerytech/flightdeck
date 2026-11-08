import { describe, expect, test } from "bun:test";
import type { HarnessPreview, ProjectLoad } from "@flightdeck/protocol";
import { addsNothing, harnessParts, needsReformat, templateIdFrom } from "../src/lib/harness.ts";

/** Issue #75, slice S1: a project's harness as a checklist, from what the host already lists. */
const EMPTY: ProjectLoad = {
  path: "/work/api",
  hooks: [],
  mcpServers: [],
  envKeys: [],
  allowRules: [],
  defaultMode: null,
  agents: [],
  skills: [],
  commands: [],
  claudeMd: false,
  executables: [],
  redirects: [],
  plugins: [],
  otherKeys: [],
  extras: [],
  unreadable: [],
  omitted: { hooks: 0, mcpServers: 0, allowRules: 0, envKeys: 0 },
};

/** A project set up like Flightdeck's own. */
const FULL: ProjectLoad = {
  ...EMPTY,
  claudeMd: true,
  hooks: [
    {
      event: "PostToolUse",
      file: ".claude/settings.json",
      commands: ["bunx biome format --write $FILE"],
    },
    {
      event: "PreToolUse",
      file: ".claude/settings.json",
      commands: ["bun run scripts/guard.ts # blocks git add -A", "./block-env.sh .env"],
    },
  ],
  skills: ["tdd-area", "new-phase"],
  agents: ["spec-verifier", "security-reviewer"],
  allowRules: ["Bash(bun test:*)", "Bash(bun run lint)"],
  // Three more rules were cut from the listing: they still count.
  omitted: { hooks: 0, mcpServers: 0, allowRules: 3, envKeys: 0 },
  mcpServers: [{ name: "db", file: ".mcp.json", command: "node db.js" }],
  envKeys: ["SONAR_TOKEN"],
};

describe("harness: a project's Claude Code setup as a checklist (#75)", () => {
  test("a project with nothing has every part missing, in the card's order", () => {
    expect(harnessParts(EMPTY)).toEqual([
      { part: "claudeMd", found: false, detail: [] },
      { part: "hooks", found: false, detail: [] },
      { part: "skills", found: false, detail: [] },
      { part: "agents", found: false, detail: [] },
      { part: "permissions", found: false, detail: [] },
      { part: "mcp", found: false, detail: [] },
    ]);
  });

  test("a project set up like Flightdeck's has all six, each with what shows it", () => {
    expect(harnessParts(FULL)).toEqual([
      { part: "claudeMd", found: true, detail: [] },
      { part: "hooks", found: true, detail: ["format", "gitAdd", "secrets"] },
      { part: "skills", found: true, detail: ["tdd-area", "new-phase"] },
      { part: "agents", found: true, detail: ["spec-verifier", "security-reviewer"] },
      // A host older than deny rules sends none: the count says nothing about them.
      { part: "permissions", found: true, detail: ["5"] },
      { part: "mcp", found: true, detail: ["db"] },
    ]);
  });

  test("a hook is found whatever it does; a kind needs a command that says so, on the event it acts on", () => {
    const hooks = (event: string, commands: string[]) =>
      harnessParts({ ...EMPTY, hooks: [{ event, file: ".claude/settings.json", commands }] })[1];
    expect([
      hooks("PostToolUse", ["./notify.sh"]),
      hooks("PostToolUse", ["prettier --write ."]),
      hooks("PostToolUse", ["ruff format"]),
      // A formatter runs after an edit; before one it formats nothing the agent wrote.
      hooks("PreToolUse", ["prettier --write ."]),
      // A check on git add or on secret files acts before the tool runs; after it, it guards nothing.
      hooks("PreToolUse", ["./guard.sh git add"]),
      hooks("PostToolUse", ["git add -A"]),
      hooks("PreToolUse", ["./deny.sh .env credentials"]),
      hooks("PostToolUse", ["cat ~/.aws/credentials"]),
    ]).toEqual([
      { part: "hooks", found: true, detail: [] },
      { part: "hooks", found: true, detail: ["format"] },
      { part: "hooks", found: true, detail: ["format"] },
      { part: "hooks", found: true, detail: [] },
      { part: "hooks", found: true, detail: ["gitAdd"] },
      { part: "hooks", found: true, detail: [] },
      { part: "hooks", found: true, detail: ["secrets"] },
      { part: "hooks", found: true, detail: [] },
    ]);
  });

  test("the formatter hook the harness preview proposes, a runner's format script or cargo fmt, is a formatter", () => {
    const hooks = (commands: string[]) =>
      harnessParts({
        ...EMPTY,
        hooks: [{ event: "PostToolUse", file: ".claude/settings.json", commands }],
      })[1]?.detail;
    expect([
      hooks(["bun run format"]),
      hooks(["pnpm run fmt"]),
      hooks(["cargo fmt"]),
      hooks(["bun run formatted-report"]),
    ]).toEqual([["format"], ["format"], ["format"], []]);
  });

  test("a format check is not a formatter; go fmt and deno fmt are; black counts only as the command run (#927)", () => {
    const hooks = (commands: string[]) =>
      harnessParts({
        ...EMPTY,
        hooks: [{ event: "PostToolUse", file: ".claude/settings.json", commands }],
      })[1]?.detail;
    expect([
      hooks(["bun run format:check"]),
      hooks(["npm run format-check"]),
      hooks(["go fmt ./..."]),
      hooks(["deno fmt"]),
      hooks(["black ."]),
      hooks(["cd api && black ."]),
      hooks(["echo black"]),
      // A runner or `-m` in front of black still runs it; a script that formats under another suffix formats.
      hooks(["poetry run black ."]),
      hooks(["python -m black ."]),
      hooks(["bun run format:write"]),
      hooks(["npm run format-all"]),
    ]).toEqual([
      [],
      [],
      ["format"],
      ["format"],
      ["format"],
      ["format"],
      [],
      ["format"],
      ["format"],
      ["format"],
      ["format"],
    ]);
  });

  test("permissions count what the project denies too, and a host older than deny rules counts none (#75)", () => {
    const denies = { ...EMPTY, denyRules: ["Read(./.env)", "Read(~/.ssh/**)"] };
    const allowsOnly = { ...EMPTY, allowRules: ["Read"], denyRules: [] };
    const cut = { ...denies, omitted: { ...EMPTY.omitted, denyRules: 4 } };
    expect([
      harnessParts(denies)[4],
      harnessParts(cut)[4],
      harnessParts(allowsOnly)[4],
      harnessParts(EMPTY)[4],
    ]).toEqual([
      { part: "permissions", found: true, detail: ["0", "2"] },
      { part: "permissions", found: true, detail: ["0", "6"] },
      { part: "permissions", found: true, detail: ["1", "0"] },
      { part: "permissions", found: false, detail: [] },
    ]);
  });

  test("an env name or value never reaches the checklist", () => {
    const text = JSON.stringify(harnessParts({ ...FULL, envKeys: ["SONAR_TOKEN", "API_KEY"] }));
    expect([text.includes("SONAR_TOKEN"), text.includes("API_KEY")]).toEqual([false, false]);
  });
});

describe("harness: what a set-up preview would write (#75, S4b)", () => {
  const settings: NonNullable<HarnessPreview["settings"]> = {
    path: ".claude/settings.json",
    hash: "h",
    hooks: [],
    denyRules: [],
    conflicts: ["permissions"],
    reformats: true,
    digest: "d",
  };
  test("a preview of conflicts and unreadable files only adds nothing, and asks for no reformat", () => {
    const preview: HarnessPreview = { settings, files: [], unreadable: ["CLAUDE.md"] };
    expect([addsNothing(preview), needsReformat(preview)]).toEqual([true, false]);
  });

  test("a reformat is asked for only when the settings gain entries", () => {
    const adds = { ...settings, denyRules: ["Read(./.env)"] };
    const preview: HarnessPreview = { settings: adds, files: [], unreadable: [] };
    expect([addsNothing(preview), needsReformat(preview)]).toEqual([false, true]);
  });
});

describe("harness: the id a shared template gets from its title (#75)", () => {
  test("a title becomes lower case words joined by dashes, with accents dropped", () => {
    expect([
      templateIdFrom("Shop setup"),
      templateIdFrom("  Configuração da Loja!! "),
      templateIdFrom("API v2 / backend"),
    ]).toEqual(["shop-setup", "configuracao-da-loja", "api-v2-backend"]);
  });

  test("an id is at most 40 characters and never starts or ends with a dash", () => {
    const id = templateIdFrom(`${"a".repeat(39)} bbbbb`);
    expect([id.length <= 40, id.endsWith("-"), id.startsWith("a")]).toEqual([true, false, true]);
    expect(templateIdFrom("---x---")).toBe("x");
  });

  test("a title with no letter or digit has no id, so nothing can be shared under it", () => {
    expect([templateIdFrom(""), templateIdFrom("!!! ???"), templateIdFrom("日本語")]).toEqual([
      "",
      "",
      "",
    ]);
  });
});

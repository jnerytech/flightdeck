import { describe, expect, test } from "bun:test";
import type { ProjectLoad } from "@flightdeck/protocol";
import { harnessParts } from "../src/lib/harness.ts";

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

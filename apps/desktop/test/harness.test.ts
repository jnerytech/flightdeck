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
      { part: "permissions", found: true, detail: ["2"] },
      { part: "mcp", found: true, detail: ["db"] },
    ]);
  });

  test("a hook is found whatever it does; its kinds come only from commands that say so", () => {
    const hooks = (commands: string[]) =>
      harnessParts({
        ...EMPTY,
        hooks: [{ event: "PostToolUse", file: ".claude/settings.json", commands }],
      })[1];
    expect([
      hooks(["./notify.sh"]),
      hooks(["prettier --write ."]),
      hooks(["ruff format"]),
      hooks(["git diff --stat"]),
      hooks(["cat ~/.aws/credentials"]),
    ]).toEqual([
      { part: "hooks", found: true, detail: [] },
      { part: "hooks", found: true, detail: ["format"] },
      { part: "hooks", found: true, detail: ["format"] },
      { part: "hooks", found: true, detail: [] },
      { part: "hooks", found: true, detail: ["secrets"] },
    ]);
  });

  test("an env name or value never reaches the checklist", () => {
    const text = JSON.stringify(harnessParts({ ...FULL, envKeys: ["SONAR_TOKEN", "API_KEY"] }));
    expect([text.includes("SONAR_TOKEN"), text.includes("API_KEY")]).toEqual([false, false]);
  });
});

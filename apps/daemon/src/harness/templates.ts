/**
 * Issue #75, slice S3: the harness templates. Fixed text plus the detected stack's commands, which
 * are fixed forms (`bun run test`, `cargo test`), never text from a project's files.
 */
import type { HarnessStack } from "@flightdeck/protocol";

type Commands = HarnessStack["commands"];

/** What the deny rules keep the agent from reading or running: secret files, keys, a wide `git add`. */
export const DENY_RULES = [
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

/** The tools that edit files: a formatter runs after them. */
export const EDIT_MATCHER = "Edit|MultiEdit|Write";

const LABELS: ReadonlyArray<[keyof Commands, string]> = [
  ["test", "Test"],
  ["lint", "Lint"],
  ["format", "Format"],
  ["build", "Build"],
];

function commandList(commands: Commands): string {
  const lines = LABELS.filter(([key]) => commands[key] !== null).map(
    ([key, label]) => `- ${label}: \`${commands[key]}\``,
  );
  return lines.length > 0
    ? lines.join("\n")
    : "- (none found yet: add the project's commands here)";
}

export function claudeMd(commands: Commands): string {
  return `# Project guide for Claude Code

## Commands

${commandList(commands)}

## Rules

- Write a failing test first, then the code that makes it pass.
- Stage files by name: never \`git add -A\` or \`git add .\`.
- Never read or print secrets: \`.env\` files, keys, credentials.
`;
}

export function reviewerAgent(commands: Commands): string {
  const test = commands.test ? ` Run \`${commands.test}\` and report what fails.` : "";
  return `---
name: reviewer
description: Reviews the current change for bugs, missing tests and unsafe code. Read-only.
tools: Read, Grep, Glob, Bash
---

Review the change on the current branch. Report each finding as \`path:line\`, what is wrong and how
to fix it, the most severe first. Do not edit files.${test}
`;
}

export function tddSkill(commands: Commands): string {
  const run = commands.test ? `\`${commands.test}\`` : "the project's test command";
  return `---
name: tdd
description: Change behavior test first. Use for any new feature or bug fix.
---

1. Write a test for the behavior. Run ${run} and see it fail on an assertion.
2. Write the smallest change that makes it pass. Run ${run} again.
3. Clean up with the tests green, then commit.
`;
}

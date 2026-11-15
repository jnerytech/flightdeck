/**
 * The pure rules of a card's starting spec (issue #78, slice S-T1): when a project asks for one,
 * how the built-in template renders, the first prompt's line, and which folder a project's own
 * templates may come from. The files and the worktree are `../spec-template.ts`.
 */
import {
  BoardColumn,
  type ContractOverrides,
  contractOf,
  hasChecklistItem,
} from "@flightdeck/protocol";

/** The project's TDD skill, as the harness setup writes it (#75). */
export const TDD_SKILL = ".claude/skills/tdd/SKILL.md";

const BODY = `# {{title}}

<!-- Remove "draft: true" above once this spec is complete: until then the card's spec check is not met. -->

## Goal

What this card changes, and why.

## Acceptance criteria

{{criteria}}

## Out of scope

## Test plan

One failing test per acceptance criterion, written and committed before the code that makes it pass.
`;

/** A project asks for a spec when a column's contract checks one, or the card names its own. */
export function wantsSpec(contracts: ContractOverrides, specPath: string | null): boolean {
  if (specPath !== null) return true;
  return BoardColumn.options.some((column) =>
    contractOf(column, contracts)?.checks.includes("spec"),
  );
}

/** The card's spec from the template: front matter, title and the checklist of its description. */
export function renderSpec(
  card: { id: string; title: string; description: string },
  template: string = BODY,
): string {
  // One line, so it can neither end the heading nor the front matter early.
  const title = card.title.replace(/[\r\n]+/g, " ").trim();
  const items = card.description.split(/\r?\n/).filter(hasChecklistItem);
  const values: Record<string, string> = {
    title,
    criteria: items.length > 0 ? items.join("\n") : "- [ ] ",
  };
  // One pass: a criterion that names a placeholder stays as it is.
  const body = template.replace(/\{\{(title|criteria)\}\}/g, (_, key: string) => values[key] ?? "");
  const front = [
    "---",
    `card: ${card.id}`,
    `title: ${JSON.stringify(title)}`,
    "draft: true",
    "---",
  ];
  return `${front.join("\n")}\n\n${body}`;
}

/** The first prompt's line: spec first, then a failing test per criterion, then the code. */
export function specFirstLine(path: string, skill: boolean): string {
  const how = skill ? ` The project's tdd skill (${TDD_SKILL}) describes how.` : "";
  return (
    `Start with the spec at \`${path}\`: read it, and if it is a draft, complete it and remove ` +
    `"draft: true" from its front matter. Then work test first: for each acceptance criterion, ` +
    `write a failing test and commit it, then the code that makes it pass.${how}`
  );
}

/**
 * A spec path as `/`-separated folders: on Windows a backslash separates them too, so each folder on
 * the way is checked; elsewhere a backslash is part of a name, as `readSpec` reads it.
 */
export function toSlashes(path: string, platform: string): string {
  return platform === "win32" ? path.replaceAll("\\", "/") : path;
}

/**
 * The folder a project's own templates may be read from: the trusted checkout `sessionTrust` names,
 * or null for an untrusted project. A card runs in a worktree, so the checkout is always named; when
 * it is not, null, never the worktree, whose content is the branch's. `ownFolder` is a card's
 * project folder itself (a card with no worktree), which is the checkout, so a trusted one stands.
 */
export function templateRootOf(
  trust: { trusted: boolean; configRoot?: string },
  ownFolder?: string,
): string | null {
  return trust.trusted ? (trust.configRoot ?? ownFolder ?? null) : null;
}

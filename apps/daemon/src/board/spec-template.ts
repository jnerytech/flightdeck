/**
 * Issue #78, slice S-T1: the spec a card starts with, when its project asks for one. It is written
 * into the card's new worktree from a built-in template, marked `draft: true` until the person or
 * the agent completes it, and the first prompt says spec first, then test first.
 * See docs/decisions/2026-11-08-spec-template.md.
 */
import { lstat, realpath } from "node:fs/promises";
import { join } from "node:path";
import {
  BoardColumn,
  type ContractOverrides,
  contractOf,
  hasChecklistItem,
  specPathProblem,
} from "@flightdeck/protocol";
import { createInside, readInsideWhy, walkInside } from "../create-inside.ts";

/** The project's TDD skill, as the harness setup writes it (#75). */
const TDD_SKILL = ".claude/skills/tdd/SKILL.md";

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

/**
 * Writes the spec at `path` in the worktree when no file is there: "exists" leaves the person's own,
 * "failed" is a path that cannot be made (a link, a file where a folder goes).
 */
export async function writeSpec(
  worktree: string,
  path: string,
  content: string,
): Promise<"written" | "exists" | "failed"> {
  if (specPathProblem(path) !== null) return "failed";
  try {
    const root = await realpath(worktree);
    const there = await lstat(join(root, path)).then(
      () => true,
      () => false,
    );
    if (there) return "exists";
    const rel = toSlashes(path, process.platform);
    return (await createInside(root, rel, content)) ? "written" : "failed";
  } catch {
    return "failed";
  }
}

/** A project's own templates, and the most of one read: a template is a page, not a book. */
const PROJECT_TEMPLATES = {
  spec: ".flightdeck/templates/spec.md",
  validation: ".flightdeck/templates/validation.md",
} as const;
export type TemplateName = keyof typeof PROJECT_TEMPLATES;
const TEMPLATE_MAX = 32 * 1024;

/** Why a project's template that is there was not used. */
export type TemplateIgnored = "untrusted" | "unsafe" | "too_big" | "empty";

/**
 * The body a trusted project gives its specs (`.flightdeck/templates/spec.md` under `root`, the
 * trusted checkout), or why it gives none: nothing is there (`ignored` null), or it is empty, too
 * big, or reached through a link or a second name. The host adds the front matter (with
 * `draft: true`) either way.
 */
export async function projectTemplate(
  root: string,
  name: TemplateName = "spec",
): Promise<{ body: string | null; ignored: TemplateIgnored | null }> {
  const read = await readInsideWhy(root, PROJECT_TEMPLATES[name], TEMPLATE_MAX);
  if ("why" in read) return { body: null, ignored: read.why === "absent" ? null : read.why };
  return read.text.trim() ? { body: read.text, ignored: null } : { body: null, ignored: "empty" };
}

/**
 * For a project that is not trusted: whether its worktree carries a template that is therefore not
 * read. Only a look at the name (never the text), so an untrusted file stays unread.
 */
export async function untrustedTemplate(
  worktree: string,
  name: TemplateName = "spec",
): Promise<boolean> {
  try {
    // A link anywhere on the way is refused, not followed: the look never leaves the worktree, so
    // it cannot tell whether something lies behind a link.
    const found = await walkInside(await realpath(worktree), PROJECT_TEMPLATES[name], TEMPLATE_MAX);
    return found.state !== "absent";
  } catch {
    return false;
  }
}

/** Whether the worktree has the TDD skill the first prompt can name. */
export function hasTddSkill(worktree: string): Promise<boolean> {
  return lstat(join(worktree, TDD_SKILL)).then(
    (info) => info.isFile(),
    () => false,
  );
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

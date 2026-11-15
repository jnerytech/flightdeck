/**
 * Issue #78, slice S-T1: the spec a card starts with, when its project asks for one. It is written
 * into the card's new worktree from a built-in template, marked `draft: true` until the person or
 * the agent completes it, and the first prompt says spec first, then test first.
 * See docs/decisions/2026-11-08-spec-template.md.
 */
import { lstat, realpath } from "node:fs/promises";
import { join } from "node:path";
import { specPathProblem } from "@flightdeck/protocol";
import { createInside, readInsideWhy, walkInside } from "./create-inside.ts";
import { TDD_SKILL, toSlashes } from "./domain/spec-template.ts";

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
  cards: ".flightdeck/templates/cards.json",
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

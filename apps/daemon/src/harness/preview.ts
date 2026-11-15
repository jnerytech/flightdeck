/**
 * Issue #75, slice S3: what adding the chosen harness parts to a project would add, written nowhere.
 * For `.claude/settings.json`, only the entries to append (its text may hold `env` values); a key in
 * the way is reported, never replaced. A Markdown part is a new file, proposed only when missing.
 * See docs/decisions/2026-11-07-harness-preview.md.
 */
import { constants } from "node:fs";
import { access, readFile, realpath } from "node:fs/promises";
import type { HarnessPreview, HarnessStack } from "@flightdeck/protocol";
import { type Walk, walkInside } from "../board/index.ts";
import {
  type Current,
  type Look,
  type PreviewPart,
  SETTINGS,
  settingsProposal,
  sha256,
} from "./domain/settings-proposal.ts";
import { claudeMd, reviewerAgent, tddSkill } from "./domain/templates.ts";
import { detectStack } from "./stack.ts";
import type { TemplateMarkdown } from "./templates-store.ts";

type Commands = HarnessStack["commands"];

export const MAX_FILE = 256 * 1024;

/** The Markdown parts: each one new file, in the order the preview lists them. */
const FILES: ReadonlyArray<[PreviewPart, string, (commands: Commands) => string]> = [
  ["claudeMd", "CLAUDE.md", claudeMd],
  ["agents", ".claude/agents/reviewer.md", reviewerAgent],
  ["skills", ".claude/skills/tdd/SKILL.md", tddSkill],
];

export const orNull = <T>(promise: Promise<T>): Promise<T | null> =>
  promise.then(
    (value) => value,
    () => null,
  );

/**
 * A project file as it is now, walked one name at a time from the project's real root: missing (and
 * every folder above it a real folder of the project, where S4 may create it), a plain file of a sane
 * size, or refused (a link anywhere on the way). See `walkInside`.
 */
export const walk = (root: string, name: string): Promise<Walk> => walkInside(root, name, MAX_FILE);

/** A file's bytes as the preview sees them: its text and sha256. */
export const fileLook = (bytes: Buffer): Look => ({
  state: "file",
  text: bytes.toString("utf8"),
  hash: sha256(bytes),
});

async function look(root: string, name: string): Promise<Look> {
  const found = await walk(root, name);
  if (found.state !== "file") return found;
  const bytes = await orNull(readFile(found.at));
  return bytes === null ? { state: "refused" } : fileLook(bytes);
}

/**
 * The settings as apply would find them: a file with a second name (a hard link, which may lie
 * outside the project) or one the host cannot write is refused here too, so the preview never offers
 * what apply would turn down.
 */
async function settingsLook(root: string): Promise<Look> {
  const found = await walk(root, SETTINGS);
  if (found.state !== "file") return found;
  const writable = await access(found.at, constants.W_OK).then(
    () => true,
    () => false,
  );
  if (found.info.nlink !== 1n || !writable) return { state: "refused" };
  return look(root, SETTINGS);
}

/** What the preview proposes, and the settings it was made from (apply writes from these). */
export interface Plan {
  preview: HarnessPreview;
  current: Current | null;
}

/**
 * The proposals for the project at its real `root`. `readSettings` reads `.claude/settings.json`:
 * the preview reads it plainly, apply from the handle it will write through.
 */
export async function planHarness(
  root: string,
  parts: readonly PreviewPart[],
  readSettings: (root: string) => Promise<Look>,
  /** A held draft to propose instead of the template (#75, G1), by file; null for the template. */
  drafted: (name: string) => string | null = () => null,
  /** A host template's Markdown to propose instead of the fixed files and any draft (#75, T1b). */
  template: TemplateMarkdown | null = null,
): Promise<Plan> {
  const { commands } = await detectStack(root);
  const unreadable: string[] = [];
  const wantsSettings = parts.includes("hooks") || parts.includes("permissions");
  const made = wantsSettings
    ? settingsProposal(await readSettings(root), parts, commands.format, unreadable)
    : null;
  const files: HarnessPreview["files"] = [];
  // A template's files are the Markdown parts, and only they: a part it lacks proposes nothing.
  const markdown: Array<[PreviewPart, string, () => string]> = template
    ? template.files.map((file) => [file.part, file.path, () => file.content])
    : FILES.map(([part, name, make]) => [part, name, () => drafted(name) ?? make(commands)]);
  const wanted = markdown.filter(([part]) => parts.includes(part));
  // Each file is looked at on its own; the answers are used in the order of the list.
  const looks = await Promise.all(wanted.map(([, name]) => look(root, name)));
  for (const [at, [, name, content]] of wanted.entries()) {
    const file = looks[at] as Awaited<ReturnType<typeof look>>;
    if (file.state === "refused") unreadable.push(name);
    else if (file.state === "absent") {
      const text = content();
      files.push({ path: name, content: text, digest: sha256(text) });
    }
  }
  const preview: HarnessPreview = { settings: made?.proposal ?? null, files, unreadable };
  if (template) {
    preview.withheld = template.withheld
      .filter(({ part }) => parts.includes(part))
      .map(({ path, reason }) => ({ path, reason }));
  }
  return { preview, current: made?.current ?? null };
}

/** What adding the chosen parts to the project at `path` would add. Nothing is written or run. */
export async function previewHarness(
  path: string,
  parts: readonly PreviewPart[],
  template: TemplateMarkdown | null = null,
): Promise<HarnessPreview> {
  const root = (await orNull(realpath(path))) ?? path;
  return (await planHarness(root, parts, settingsLook, undefined, template)).preview;
}

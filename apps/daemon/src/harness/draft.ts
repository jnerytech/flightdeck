/**
 * Issue #75, slice G1: a CLAUDE.md drafted by the host's model. The model is told the detected
 * stack's commands and the project's top-level names, never a file's content (no prompt injection
 * from the files, no `env` value). The host holds the draft by its digest for a while; an apply
 * whose digest for CLAUDE.md is the draft's writes it, so the text never comes from the app.
 * See docs/decisions/2026-11-08-harness-draft.md.
 */
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { DEFAULT_MODELS, type HarnessDraft, type SecretScanner } from "@flightdeck/protocol";
import { walkInside } from "../board/index.ts";
import { FlightdeckError } from "../kernel/index.ts";
import type { Quota } from "../quota/index.ts";
import type { CompleteOptions, CompleteResult } from "../runtime/index.ts";
import { factsText, SYSTEM, toldNames } from "./domain/draft-facts.ts";
import { DraftShelf, FILE } from "./domain/draft-shelf.ts";
import { MAX_FILE } from "./preview.ts";
import { detectStack } from "./stack.ts";

export interface DraftDeps {
  complete(opts: CompleteOptions): Promise<CompleteResult>;
  quota?: Pick<Quota, "blocked">;
  /** The host's scanner (the vault's values among them): nothing secret is held or shown. */
  scanner: Pick<SecretScanner, "scan">;
  /** The assistant's scratch folder, where one-shot calls run. */
  cwd: string;
  allowApiKey: boolean;
  model?: string;
  now?: () => number;
}

const MAX_DRAFT = 32 * 1024;

const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

const refuse = (reason: string, message: string, params?: Record<string, string>) =>
  new FlightdeckError("invalid_state", message, reason, params);

/** The drafts the host made and holds, by digest. */
export class HarnessDrafts {
  private readonly shelf = new DraftShelf(() => this.deps.now?.() ?? Date.now());
  /** The draft under way per project: a second ask waits for it instead of spending again. */
  private readonly inFlight = new Map<string, Promise<HarnessDraft>>();

  constructor(private readonly deps: DraftDeps) {}

  /** Drafts a CLAUDE.md for the project at `root`, which must not have one. */
  draft(root: string): Promise<HarnessDraft> {
    const running = this.inFlight.get(root);
    if (running) return running;
    const made = this.make(root).finally(() => this.inFlight.delete(root));
    this.inFlight.set(root, made);
    return made;
  }

  private async make(root: string): Promise<HarnessDraft> {
    if ((await walkInside(root, FILE, MAX_FILE)).state !== "absent") {
      throw refuse("harness_draft_exists", "the project has a CLAUDE.md: a draft only creates one");
    }
    const blocked = this.deps.quota?.blocked();
    if (blocked) {
      const until = blocked.until === null ? "" : new Date(blocked.until).toISOString();
      throw refuse("assistant_quota_blocked", "the plan's quota is used up for now", { until });
    }
    const result = await this.deps.complete({
      model: this.deps.model ?? DEFAULT_MODELS.host.careful,
      system: SYSTEM,
      prompt: await this.facts(root),
      cwd: this.deps.cwd,
      effort: "low",
      thinking: "off",
      allowApiKey: this.deps.allowApiKey,
    });
    const content = `${result.text.trim()}\n`;
    if (!content.startsWith("# ") || content.length > MAX_DRAFT) {
      throw refuse("harness_draft_failed", "the model did not answer with a CLAUDE.md");
    }
    if (this.deps.scanner.scan(content).length > 0) {
      throw refuse("harness_draft_secret", "the draft holds a secret: it is not kept or shown");
    }
    const digest = sha256(content);
    this.shelf.keep(root, digest, content);
    return { path: FILE, content, digest };
  }

  /** The draft of `file` for the project at `root` with this digest, while held; else null. */
  held(root: string, file: string, digest: string): string | null {
    return this.shelf.held(root, file, digest);
  }

  /** What the model is told: the stack and its commands, and the top-level names, never content. */
  private async facts(root: string): Promise<string> {
    const stack = await detectStack(root);
    const entries = await readdir(root).catch(() => [] as string[]);
    return factsText(stack, toldNames(entries, this.deps.scanner));
  }
}

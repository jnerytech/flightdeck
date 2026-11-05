/** Phase 40: the host's assistant, wired to the board, the allowed roots and the scanner. */
import type { SecretScanner } from "@flightdeck/protocol";
import type { Board } from "../board/board.ts";
import type { UsageIndexer } from "../costs/usage-indexer.ts";
import { FlightdeckError, featureOff } from "../errors.ts";
import { resolveAllowedCwd } from "../paths.ts";
import type { Quota } from "../quota/quota.ts";
import type { AgentRuntime, CompleteOptions, CompleteResult } from "../runtime/types.ts";
import { repoContext } from "./context.ts";
import { AssistantService } from "./service.ts";

export interface AssistantDeps {
  runtime: Partial<AgentRuntime>;
  usage: Pick<UsageIndexer, "record">;
  quota?: Pick<Quota, "blocked">;
  scanner: Pick<SecretScanner, "scan">;
  board?: Pick<Board, "getCard" | "getProject">;
  allowedRoots: readonly string[];
  dataDir: string;
  allowApiKey: boolean;
  log?: (line: string) => void;
}

/** A card's worktree and base branch, from the board. */
function cardWorktree(board: AssistantDeps["board"], cardId: string) {
  if (!board) throw featureOff("board");
  const card = board.getCard(cardId);
  if (!card.worktreePath) {
    throw new FlightdeckError("invalid_state", "the card has no worktree yet", "card_no_worktree");
  }
  return { worktree: card.worktreePath, base: board.getProject(card.projectId).baseBranch };
}

/** The assistant of a runtime that can run a one-shot; none for one that cannot. */
export function assistantService(deps: AssistantDeps): AssistantService | undefined {
  if (!deps.runtime.complete) return undefined;
  const runtime = deps.runtime as { complete(opts: CompleteOptions): Promise<CompleteResult> };
  return new AssistantService({
    runtime,
    usage: deps.usage,
    ...(deps.quota ? { quota: deps.quota } : {}),
    scanner: deps.scanner,
    context: (source) =>
      repoContext(source, {
        card: (cardId) => cardWorktree(deps.board, cardId),
        allowed: (cwd) => resolveAllowedCwd(cwd, deps.allowedRoots),
        scanner: deps.scanner,
      }),
    dataDir: deps.dataDir,
    allowApiKey: deps.allowApiKey,
    ...(deps.log ? { log: deps.log } : {}),
  });
}

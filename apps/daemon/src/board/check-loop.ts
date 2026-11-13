/**
 * Issue #1361: the card's switch for "keep going until the checks pass"
 * (docs/decisions/2026-11-09-check-loop.md). The checks run code the card's session writes,
 * outside its permission mode: outside `bypassPermissions` the person confirms that, and the
 * confirmation is bound to what it confirmed (the checks, `checkEnv` and the mode).
 */
import type { Card, PermissionMode } from "@flightdeck/protocol";
import { FlightdeckError } from "../kernel/index.ts";
import type { WatchSettings } from "../watch/settings.ts";
import { confirmationHash } from "./check-loop-engine.ts";

/** Why the switch stays off. */
export type CheckLoopRefusal =
  | "check_loop_no_checks"
  | "check_loop_untrusted"
  | "check_loop_mode"
  | "check_loop_confirm";

const WHY: Record<CheckLoopRefusal, string> = {
  check_loop_no_checks: "the project has no checks to run",
  check_loop_untrusted: "the project is not trusted",
  check_loop_mode: "in plan mode the session cannot fix anything",
  check_loop_confirm: "outside bypassPermissions the person confirms first",
};

/**
 * Null when the switch may turn on, else why not, in this order: checks to run, a trusted
 * project, a mode that can edit, and a confirmation outside `bypassPermissions`.
 */
export function checkLoopRefusal(input: {
  checks: readonly string[];
  trusted: boolean;
  mode: PermissionMode;
  confirm: boolean;
}): CheckLoopRefusal | null {
  if (input.checks.length === 0) return "check_loop_no_checks";
  if (!input.trusted) return "check_loop_untrusted";
  if (input.mode === "plan") return "check_loop_mode";
  if (input.mode !== "bypassPermissions" && !input.confirm) return "check_loop_confirm";
  return null;
}

/** What the switch needs of the board: a port, so this file does not import the board. */
interface CheckLoopBoard {
  getCard(id: string): Card;
  getProject(id: string): { path: string };
  storeCheckLoop(
    id: string,
    value: {
      on: boolean;
      rounds: number | null;
      confirmedAt: string | null;
      confirmedHash: string | null;
    },
  ): Card;
}

export interface CheckLoopDeps {
  board: CheckLoopBoard;
  settings(projectId: string): WatchSettings;
  isTrusted(path: string): boolean;
  /** The mode the card's session runs in now, or would start in. */
  modeOf(card: Card): PermissionMode;
  now?: () => Date;
}

/** Turns a card's check loop on or off (the protocol's `card.checkLoop`). */
export class CheckLoopSwitch {
  constructor(private readonly deps: CheckLoopDeps) {}

  set(cardId: string, request: { on: boolean; confirm?: boolean; rounds?: number | null }): Card {
    const { board } = this.deps;
    const card = board.getCard(cardId);
    const rounds = request.rounds === undefined ? (card.checkLoop?.rounds ?? null) : request.rounds;
    if (!request.on) {
      return board.storeCheckLoop(cardId, {
        on: false,
        rounds,
        confirmedAt: null,
        confirmedHash: null,
      });
    }
    const settings = this.deps.settings(card.projectId);
    const mode = this.deps.modeOf(card);
    const refusal = checkLoopRefusal({
      checks: settings.checks,
      trusted: this.deps.isTrusted(board.getProject(card.projectId).path),
      mode,
      confirm: request.confirm === true,
    });
    if (refusal) throw new FlightdeckError("invalid_state", WHY[refusal], refusal);
    const confirmed = mode !== "bypassPermissions";
    const at = (this.deps.now ?? (() => new Date()))().toISOString();
    return board.storeCheckLoop(cardId, {
      on: true,
      rounds,
      confirmedAt: confirmed ? at : null,
      confirmedHash: confirmed ? confirmationHash(settings.checks, settings.checkEnv, mode) : null,
    });
  }
}

/**
 * The mode a card's switch is decided on: a live session's mode now; for a session that is over
 * or gone, the mode its next run starts in (the variant's, else the host's default), never the one
 * the old session ended in.
 */
export function cardMode(
  card: Pick<Card, "sessionId" | "sessionStatus" | "variant">,
  manager: { modeOf(sessionId: string | null): PermissionMode },
): PermissionMode {
  const next = () => card.variant?.permissionMode ?? manager.modeOf(null);
  const over = card.sessionStatus === "ended" || card.sessionStatus === "error";
  if (card.sessionId === null || over) return next();
  try {
    return manager.modeOf(card.sessionId);
  } catch {
    return next();
  }
}

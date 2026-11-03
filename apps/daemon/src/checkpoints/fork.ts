/**
 * Phase 12: "Bifurcar daqui". The SDK's forkSession copies the transcript up to a message into a
 * new Claude session (written by the SDK itself into ~/.claude/projects, the only write there that
 * comes from this phase). It opens as a resumed managed session, or as the command that opens it
 * in the terminal. The files can be rewound to the turn first.
 */

import { FlightdeckError } from "../errors.ts";
import { type Prepare, withoutPersonas } from "../personas/prepare.ts";
import type { AgentRuntime } from "../runtime/types.ts";
import type { SessionManager } from "../sessions/session-manager.ts";
import type { Rewinder } from "./rewind.ts";

export interface ForkRequest {
  claudeSessionId: string;
  /** Uuid of the last message kept; the whole transcript without it. */
  upToMessageId?: string;
  cwd: string;
  open: "flightdeck" | "terminal";
  /** Rewind the files to before this turn (a `before` snapshot's n) first. */
  rewindTurn?: number;
}

export interface ForkResult {
  claudeSessionId: string;
  /** The managed session it opened as (`open: "flightdeck"`). */
  sessionId?: string;
  /** What opens it in a terminal (`open: "terminal"`). */
  command?: string;
}

export class Forker {
  constructor(
    private readonly opts: {
      runtime: AgentRuntime;
      manager: Pick<SessionManager, "createResumed">;
      rewinder?: Rewinder;
      /** Reads the personas for the forked session; none when absent. */
      preparePersonas?: Prepare;
    },
  ) {}

  async fork(request: ForkRequest): Promise<ForkResult> {
    const fork = this.opts.runtime.forkSession;
    if (!fork)
      throw new FlightdeckError(
        "invalid_state",
        "this runtime does not fork sessions",
        "fork_unsupported",
      );
    if (request.rewindTurn !== undefined) {
      await this.opts.rewinder?.apply(request.claudeSessionId, request.rewindTurn, true);
    }
    const { sessionId: claudeSessionId } = await fork.call(
      this.opts.runtime,
      request.claudeSessionId,
      {
        ...(request.upToMessageId ? { upToMessageId: request.upToMessageId } : {}),
        dir: request.cwd,
      },
    );
    if (request.open === "terminal") {
      return { claudeSessionId, command: `flightdeckd claude --resume ${claudeSessionId}` };
    }
    const { agents } = await (this.opts.preparePersonas ?? withoutPersonas)(undefined, request.cwd);
    const { sessionId } = await this.opts.manager.createResumed({
      cwd: request.cwd,
      claudeSessionId,
      name: null,
      agents,
    });
    return { claudeSessionId, sessionId };
  }
}

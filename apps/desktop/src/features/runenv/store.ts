import type { RunConfigInfo, RunState } from "@flightdeck/protocol";

/** The run environments' part of the app's state: each card's run, by host and card. */
interface RunEnvSliceState {
  runEnvs: Record<string, RunState>;
}

/** What the run environment reads and asks through the app's store (#1596). */
export interface RunEnvCore {
  state(): RunEnvSliceState;
  update(patch: Partial<RunEnvSliceState>): void;
  /** The key of a card's run in `runEnvs`: the sessions' key, host and card. */
  key(hostId: string, cardId: string): string;
  /** The project's run.yaml (`runenv.config`); null when the host refuses (the banner says why). */
  config(hostId: string, projectId: string): Promise<RunConfigInfo | null>;
  /** Trusts the reviewed run.yaml (`runenv.trust`); null when the host refuses. */
  trust(hostId: string, projectId: string, hash: string): Promise<RunConfigInfo | null>;
  /** Starts the card's run (`runenv.start`); null when the host refuses. */
  start(hostId: string, cardId: string): Promise<RunState | null>;
  /** Stops the card's run (`runenv.stop`); null when the host refuses. */
  stop(hostId: string, cardId: string): Promise<RunState | null>;
}

/** A card's run environment: its run.yaml, its trust, and its processes started and stopped (#1596: a slice of the store). */
export class RunEnvSlice {
  constructor(private readonly core: RunEnvCore) {}

  /** The run.yaml of a project on its base branch, with its validation and trust. */
  config(hostId: string, projectId: string): Promise<RunConfigInfo | null> {
    return this.core.config(hostId, projectId);
  }

  /** Trusts the run.yaml the user reviewed. */
  trust(hostId: string, projectId: string, hash: string): Promise<RunConfigInfo | null> {
    return this.core.trust(hostId, projectId, hash);
  }

  /** Run: the card's setup (once) and processes. A refusal goes to the banner. */
  async start(hostId: string, cardId: string): Promise<void> {
    const state = await this.core.start(hostId, cardId);
    if (state) this.updated(hostId, state);
  }

  /** Stop: ends the card's processes and everything they started. */
  async stop(hostId: string, cardId: string): Promise<void> {
    const state = await this.core.stop(hostId, cardId);
    if (state) this.updated(hostId, state);
  }

  /** A card's run as the host now tells it. */
  updated(hostId: string, state: RunState): void {
    const { runEnvs } = this.core.state();
    this.core.update({ runEnvs: { ...runEnvs, [this.core.key(hostId, state.cardId)]: state } });
  }
}

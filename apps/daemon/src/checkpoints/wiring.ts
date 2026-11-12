import { type DomainModule, serverGroup } from "../server/index.ts";
import { Forker } from "./fork.ts";
import { Rewinder, type RewindSessions } from "./rewind.ts";
import type { Snapshots } from "./snapshots.ts";

/** What the checkpoints the server offers are built from (issue #2094). */
export interface CheckpointsDeps {
  snapshots: Snapshots;
  manager: RewindSessions & ConstructorParameters<typeof Forker>[0]["manager"];
  runtime: ConstructorParameters<typeof Forker>[0]["runtime"];
  /** Reads the personas for a forked session. */
  prepare: ConstructorParameters<typeof Forker>[0]["preparePersonas"];
}

/**
 * Phase 12 (issue #2094): the checkpoints' part of the server: the turns' git snapshots, going back
 * to a turn and forking a session from one.
 */
export function createCheckpoints({ snapshots, manager, runtime, prepare }: CheckpointsDeps) {
  const rewinder = new Rewinder({ snapshots, sessions: manager });
  const forker = new Forker({ runtime, manager, rewinder, preparePersonas: prepare });
  const module: DomainModule<"checkpoints"> = {
    server: { checkpoints: serverGroup<"checkpoints">()({ snapshots, rewinder, forker }) },
  };
  return { modules: [module] as const };
}

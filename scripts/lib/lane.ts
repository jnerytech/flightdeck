/**
 * The light lane: a lock with two places for the commands that are light on CPU time but heavy
 * on memory (typecheck, lint). A tsc run of this repository takes up to 1.5 GB; six at once ran the
 * machine out of memory. A third run waits for a place. It reuses the slot's lock files
 * (`tryAcquire`/`release`), one file per place. Every effect comes in through `LaneDeps`.
 */
import {
  describeHolder,
  release,
  type SlotChild,
  type SlotEnv,
  type SlotHolder,
  tryAcquire,
} from "./slot.ts";

/** How often a waiting run tries again. */
export const LANE_POLL_MS = 1000;

export interface LaneDeps {
  /** One lock per place in the lane; their number is the lane's capacity. */
  locks: SlotEnv[];
  /** Already inside the lane or the heavy slot (FLIGHTDECK_LANE_HOLDER, FLIGHTDECK_SLOT_HOLDER). */
  nested: boolean;
  sleep(ms: number): Promise<void>;
  log(line: string): void;
  /** Starts the command, marked as a lane holder so its own lane calls run at once. */
  spawn(command: string[]): SlotChild;
}

/** Runs the command once a place in the lane is free, and gives the place back after. */
export async function runInLane(command: string[], deps: LaneDeps): Promise<number> {
  if (deps.nested) return await deps.spawn(command).wait();
  const text = command.join(" ");
  let named = false;
  for (;;) {
    let place: SlotEnv | undefined;
    const holders: { holder: SlotHolder; lock: SlotEnv }[] = [];
    try {
      for (const lock of deps.locks) {
        const attempt = tryAcquire(lock, text);
        if (attempt.acquired) {
          place = lock;
          break;
        }
        if (attempt.holder) holders.push({ holder: attempt.holder, lock });
      }
    } catch (error) {
      // A lane that cannot be used must not stop the work: run without it.
      deps.log(`light lane: the lock cannot be used (${String(error)}); running without it`);
      return await deps.spawn(command).wait();
    }
    if (place) {
      try {
        return await deps.spawn(command).wait();
      } finally {
        release(place);
      }
    }
    if (!named) {
      named = true;
      const who = holders.map(({ holder, lock }) => describeHolder(holder, lock.now()));
      deps.log(`light lane busy (${deps.locks.length} places): ${who.join("; ")}; waiting`);
    }
    await deps.sleep(LANE_POLL_MS);
  }
}

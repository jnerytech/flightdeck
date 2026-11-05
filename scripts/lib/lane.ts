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
  /** How many places are open now, at most `locks.length`; asked on every try (default: all). */
  places?: () => number;
}

/**
 * The places the lane opens for the memory there is: one per 2.5 GB available, between 1 and 2
 * (one tsc run takes up to 1.5 GB). `meminfo` is /proc/meminfo, null off Linux (2 places);
 * FLIGHTDECK_LANE_PLACES (`override`) wins when it is a whole number of at least 1.
 */
export function lanePlaces(meminfo: string | null, override: string | undefined): number {
  const forced = Number(override);
  if (Number.isInteger(forced) && forced >= 1) return forced;
  const kb = Number(/^MemAvailable:\s+(\d+)\s*kB/m.exec(meminfo ?? "")?.[1]);
  if (!kb) return 2;
  return Math.min(2, Math.max(1, Math.floor(kb / (1024 * 1024) / 2.5)));
}

/** Runs the command once a place in the lane is free, and gives the place back after. */
export async function runInLane(command: string[], deps: LaneDeps): Promise<number> {
  if (deps.nested) return await deps.spawn(command).wait();
  const text = command.join(" ");
  let named = false;
  for (;;) {
    let place: SlotEnv | undefined;
    let open = deps.locks.length;
    const holders: { holder: SlotHolder; lock: SlotEnv }[] = [];
    try {
      open = deps.places ? Math.max(1, deps.places()) : deps.locks.length;
      for (const lock of deps.locks.slice(0, open)) {
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
      deps.log(`light lane busy (${open} place(s) open): ${who.join("; ")}; waiting`);
    }
    await deps.sleep(LANE_POLL_MS);
  }
}

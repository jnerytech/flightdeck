import { SshTargets } from "../../src/ssh/targets.ts";
import { EventStore } from "../../src/store/event-store.ts";

export function setup() {
  const store = new EventStore(":memory:");
  let clock = Date.parse("2026-10-29T12:00:00Z");
  const targets = new SshTargets({ db: store.db, now: () => clock });
  return {
    store,
    targets,
    tick: (ms: number) => {
      clock += ms;
    },
  };
}

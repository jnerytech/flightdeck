import { useRef, useState } from "react";

/**
 * One piece of work at a time: `run` starts `work` and, when it returns a promise, `busy` stays
 * on until it settles (a rejection too) and a second `run` does nothing meanwhile. Work that
 * returns anything else counts as instant.
 */
export function useBusy(): { busy: boolean; run(work: () => unknown): void } {
  const [busy, setBusy] = useState(false);
  // A ref too: two presses in the same event see the first before React renders it.
  const started = useRef(false);
  const run = (work: () => unknown) => {
    if (started.current) return;
    const result = work() as PromiseLike<unknown> | undefined;
    if (typeof result?.then !== "function") return;
    started.current = true;
    setBusy(true);
    const done = () => {
      started.current = false;
      setBusy(false);
    };
    result.then(done, done);
  };
  return { busy, run };
}

import { Loader2 } from "lucide-react";
import { useRef, useState } from "react";

/** The spinner of a button at work. */
export function Spinner() {
  return <Loader2 className="animate-spin" aria-hidden="true" />;
}

/** `run(task)` runs `task` unless one is running; `busy` says so (a double click does nothing). */
export function useBusy(): [boolean, (task: () => unknown) => void] {
  const [busy, setBusy] = useState(false);
  // A ref too: two calls in the same event see the first one before React renders it.
  const running = useRef(false);
  const run = (task: () => unknown) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    void Promise.resolve(task()).finally(() => {
      running.current = false;
      setBusy(false);
    });
  };
  return [busy, run];
}

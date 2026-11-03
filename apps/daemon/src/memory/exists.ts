import { stat } from "node:fs/promises";

/** Whether `path` exists (a broken link counts as missing), without holding the event loop. */
export const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );

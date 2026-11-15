import type { AppStore } from "../../lib/app-store.ts";
import { hasFeature } from "../../lib/version.ts";
import { insideFolder, resolvePath } from "./domain/terminal-paths.ts";
import { pasteLines } from "./domain/terminal-view.ts";

export type Viewing = {
  path: string;
  full: string;
  line: number | undefined;
  col: number | undefined;
};
export type Pasting = { lines: number; answer(ok: boolean): void };

/** A path clicked in the output: in the Files viewer when the terminal's folder holds it (#506), else `showPath`. */
export async function openPath(
  store: AppStore,
  hostId: string,
  folder: Promise<string | null>,
  path: string,
  at: { line: number; col?: number } | undefined,
  view: (next: Viewing) => void,
): Promise<void> {
  const cwd = await folder;
  const full = cwd ? resolvePath(cwd, path) : path;
  const inside = cwd ? insideFolder(cwd, full) : null;
  const host = store.getState().hosts.find((h) => h.id === hostId);
  if (inside && hasFeature(host?.hostInfo?.features, "file.terminal", false)) {
    view({ path: inside, full, line: at?.line, col: at?.col });
  } else await showPath(store, hostId, path, folder);
}

/** Asks for the OK of a multi-line paste: `ask` shows the question, the answer clears it and refocuses. */
export function askPaste(
  text: string,
  ask: (next: Pasting | null) => void,
  refocus: () => void,
): Promise<boolean> {
  return new Promise<boolean>((resolve) =>
    ask({
      lines: pasteLines(text),
      answer: (ok) => {
        ask(null);
        resolve(ok);
        refocus();
      },
    }),
  );
}

/**
 * A path clicked in a terminal's output (#476): on a host of this computer the file is shown in its
 * folder, never opened or run (the app's own checks refuse links, `..` and shares); on another
 * host the path is copied. A relative path is taken from the terminal's folder.
 */
async function showPath(
  store: AppStore,
  hostId: string,
  path: string,
  folder: Promise<string | null>,
): Promise<void> {
  const cwd = await folder;
  const full = cwd ? resolvePath(cwd, path) : path;
  if (store.system.canOpenPaths(hostId)) await store.system.revealPath(hostId, full);
  else await store.system.copyText(full);
}

import { resolve } from "node:path";
import { FlightdeckError } from "../errors.ts";
import { isInside } from "../paths.ts";

/**
 * The folders a removal is working on. Nothing may start in one (a session, a terminal, a card):
 * the check sits right where the starter registers itself, so a start and a removal cannot both
 * win. A held folder covers what is inside it.
 */
export class FolderLocks {
  private readonly held = new Set<string>();

  hold(path: string): void {
    this.held.add(resolve(path));
  }

  release(path: string): void {
    this.held.delete(resolve(path));
  }

  isHeld(cwd: string): boolean {
    const folder = resolve(cwd);
    return [...this.held].some((held) => isInside(held, folder));
  }
}

/** The refusal of a start in a folder being removed. */
export function folderRemoving(cwd: string): FlightdeckError {
  return new FlightdeckError("invalid_state", `${cwd} is being removed`, "folder_removing");
}

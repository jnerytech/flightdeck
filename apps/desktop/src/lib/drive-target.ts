import type { BackupTarget } from "./backup-target.ts";

/** What the Drive target needs from the sign-in: an access token, a fresh one when `refresh` is set. */
export interface DriveAuth {
  token(refresh?: boolean): Promise<string>;
}

export type DriveFailure = "auth" | "not-found" | "http" | "upload";

/** A Drive call that failed. The message never carries a token. */
export class DriveError extends Error {
  constructor(
    readonly kind: DriveFailure,
    readonly status = 0,
  ) {
    super(`drive ${kind} ${status}`);
  }
}

export function driveTarget(_deps: { fetch: typeof fetch; auth: DriveAuth }): BackupTarget {
  return {
    put: async () => {},
    list: async () => [],
    get: async () => "",
    remove: async () => {},
  };
}

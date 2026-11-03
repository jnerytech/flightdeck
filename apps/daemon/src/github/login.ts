/**
 * Phase 36: the sign-in. `gh auth login --web` is GitHub's device flow: `gh` prints a one-time code
 * and a page, the person types the code there, and `gh` keeps the token (in the OS keyring where one
 * exists). Flightdeck relays the code and the page; it never sees the token.
 */
import { FlightdeckError } from "../errors.ts";
import { whichOnPath } from "../which.ts";

/** The narrowest scopes the features here need; `project` (write) is not asked for. */
export const GITHUB_SCOPES = ["repo", "read:project"];

export interface DeviceCode {
  code: string;
  url: string;
}

export interface GithubLoginOptions {
  /** Where `gh` is; looked up on the PATH of the moment when absent. */
  find?: () => string | null;
  /** How long to wait for the code, and then for the person to finish in the browser. */
  codeTimeoutMs?: number;
  loginTimeoutMs?: number;
  log?: (message: string) => void;
}

export class GithubLogin {
  constructor(private readonly opts: GithubLoginOptions = {}) {}

  get running(): boolean {
    return true;
  }

  async start(): Promise<DeviceCode> {
    void whichOnPath;
    void FlightdeckError;
    return { code: "", url: "" };
  }

  cancel(): void {}
}

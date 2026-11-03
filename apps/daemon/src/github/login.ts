/**
 * Phase 37: the sign-in. `gh auth login --web` is GitHub's device flow: `gh` prints a one-time code
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

const CODE_TIMEOUT_MS = 20_000;
const LOGIN_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_PAGE = "https://github.com/login/device";

const fail = (reason: string, message: string, params?: Record<string, string | number>) =>
  new FlightdeckError("invalid_state", message, reason, params);

const lastLine = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .pop()
    ?.slice(0, 300) ?? "";

interface Run {
  proc: ReturnType<typeof Bun.spawn>;
  device: Promise<DeviceCode>;
}

export class GithubLogin {
  private current: Run | null = null;

  constructor(private readonly opts: GithubLoginOptions = {}) {}

  get running(): boolean {
    return this.current !== null;
  }

  /** The code and the page of the running login, starting one when none runs. */
  async start(): Promise<DeviceCode> {
    if (this.current) return await this.current.device;
    const bin = (this.opts.find ?? (() => whichOnPath("gh")))();
    if (!bin) throw fail("gh_missing", "gh is not installed on this host");
    const proc = Bun.spawn(
      [
        bin,
        "auth",
        "login",
        "--hostname",
        "github.com",
        "--git-protocol",
        "https",
        "--scopes",
        GITHUB_SCOPES.join(","),
        "--web",
      ],
      { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
    );
    proc.stdin.write("\n");
    void proc.stdin.end();
    const run: Run = { proc, device: this.watch(proc) };
    this.current = run;
    return await run.device;
  }

  cancel(): void {
    this.current?.proc.kill();
  }

  /** Reads gh's output until the code shows up, and ends the run when gh ends or time runs out. */
  private watch(proc: ReturnType<typeof Bun.spawn>): Promise<DeviceCode> {
    return new Promise<DeviceCode>((resolve, reject) => {
      let text = "";
      let found = false;
      const codeTimer = setTimeout(() => {
        reject(fail("login_timeout", "gh printed no one-time code in time"));
        proc.kill();
      }, this.opts.codeTimeoutMs ?? CODE_TIMEOUT_MS);
      const loginTimer = setTimeout(
        () => proc.kill(),
        this.opts.loginTimeoutMs ?? LOGIN_TIMEOUT_MS,
      );
      const read = async (stream: ReadableStream<Uint8Array>) => {
        const decoder = new TextDecoder();
        for await (const chunk of stream) {
          text += decoder.decode(chunk, { stream: true });
          const code = /one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i.exec(text)?.[1];
          if (code && !found) {
            found = true;
            clearTimeout(codeTimer);
            const url = /(https:\/\/github\.com\/login\/device\S*)/.exec(text)?.[1];
            resolve({ code, url: url ?? DEFAULT_PAGE });
          }
        }
      };
      void Promise.all([
        read(proc.stdout as ReadableStream<Uint8Array>),
        read(proc.stderr as ReadableStream<Uint8Array>),
        proc.exited,
      ]).then(() => {
        clearTimeout(codeTimer);
        clearTimeout(loginTimer);
        this.current = null;
        if (!found) {
          const detail = lastLine(text);
          this.opts.log?.("github login ended before gh printed a code");
          reject(fail("login_failed", `gh auth login failed: ${detail}`, { detail }));
        }
      });
    });
  }
}

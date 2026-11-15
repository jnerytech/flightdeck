import type { CommandPayload, CommandResults } from "@flightdeck/protocol";
import type { HostCommandOptions, HostCommandType, HostResult } from "../../lib/kernel.ts";
import type { RequestError } from "./host-connection.ts";

/** What the commands to a host need from the store around them. */
export interface HostCommandsPorts {
  /**
   * Sends a command to a host and gives its result; the cards and runs in it reach the app. A
   * refusal or an offline host throws, with no banner: the caller decides what it shows.
   */
  dispatch<T extends HostCommandType>(
    hostId: string,
    type: T,
    payload: CommandPayload<T>,
  ): Promise<CommandResults[T]>;
  /** Shows an error in the banner, with a retry; `answersCommand` is true when the person gave the command. */
  fail(
    error: unknown,
    text: string | undefined,
    retry: (() => void) | undefined,
    answersCommand: boolean,
  ): void;
}

/** What a command to a host comes to: an error in the banner with a retry (`command`), or a refusal handed back (`request`). */
export class HostCommands {
  constructor(private readonly ports: HostCommandsPorts) {}

  /**
   * Sends a project, board or card command to a host. Cards in the answer go to `cards`; errors
   * go to the banner and give `null`.
   */
  async command<T extends HostCommandType>(
    hostId: string,
    type: T,
    payload: CommandPayload<T>,
    options: HostCommandOptions = {},
  ): Promise<CommandResults[T] | null> {
    try {
      return await this.ports.dispatch(hostId, type, payload);
    } catch (error) {
      this.ports.fail(
        error,
        undefined,
        options.retry === false
          ? undefined
          : () =>
              void this.command(hostId, type, payload, {
                focusRefusal: options.focusRefusal === true,
              }),
        options.focusRefusal === true,
      );
      return null;
    }
  }

  /**
   * Like `command`, but a refusal comes back with its code and message instead of going to
   * the banner: for screens that explain it themselves (a file that changed, a merge conflict).
   */
  async request<T extends HostCommandType>(
    hostId: string,
    type: T,
    payload: CommandPayload<T>,
  ): Promise<HostResult<CommandResults[T]>> {
    try {
      return { ok: true, data: await this.ports.dispatch(hostId, type, payload) };
    } catch (error) {
      // A connection only ever rejects with a RequestError (even a host it does not know).
      const { code, message, reason, params, items } = error as RequestError;
      return {
        ok: false,
        code,
        message,
        ...(reason ? { reason, params: params ?? {} } : {}),
        ...(items ? { items } : {}),
      };
    }
  }
}

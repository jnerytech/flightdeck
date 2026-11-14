import type { z } from "zod";
import {
  type CommandResult,
  FlightdeckError,
  parseJsonWith,
  runCommand,
  whichOnPath,
} from "../kernel/index.ts";
import { mapSpawnError, sanitizeAzArgs } from "./domain/az-text.ts";
import type { CommandRunner } from "./domain/port.ts";

/** Runs a CLI looked up on the current PATH (so the tests' fakes win). */
export async function cli(
  name: string,
  args: string[],
  cwd: string,
  input?: string,
  run: CommandRunner = runCommand,
): Promise<CommandResult> {
  const bin = whichOnPath(name);
  if (!bin)
    throw new FlightdeckError("invalid_state", `${name} not found on the PATH`, "tool_missing", {
      name,
    });
  // The Azure CLI's free text is made safe for its .cmd shim (az-text.ts); the others keep theirs.
  const safe = name === "az" ? sanitizeAzArgs(args) : args;
  return run([bin, ...safe], cwd, input).catch(mapSpawnError);
}

/** Stdout of a CLI call that must succeed; the error names the subcommand (`gh pr view`). */
export async function cliOk(
  name: string,
  args: string[],
  cwd: string,
  input?: string,
  run: CommandRunner = runCommand,
): Promise<string> {
  const result = await cli(name, args, cwd, input, run);
  if (result.code !== 0) {
    const what = [name, ...args.slice(0, name === "az" ? 3 : 2)].join(" ");
    throw new FlightdeckError(
      "invalid_state",
      `${what} failed: ${result.stderr.trim()}`,
      "command_failed",
      { what, output: result.stderr.trim() },
    );
  }
  return result.stdout;
}

/** A CLI's JSON output checked against `schema` (#1609): a reply that does not fit fails the call. */
export const cliJsonWith = async <T>(
  schema: z.ZodType<T>,
  name: string,
  args: string[],
  cwd: string,
): Promise<T> => parseJsonWith(schema, await cliOk(name, args, cwd));

/**
 * A PR host over its CLI. `run` starts the program found on PATH: runCommand, or a stand-in a test
 * hands over so that no process starts (the lookup, the safe text and the errors stay the same).
 */
export abstract class CliProvider {
  protected readonly run: CommandRunner;

  constructor(opts: { run?: CommandRunner } = {}) {
    this.run = opts.run ?? runCommand;
  }

  protected call(name: string, args: string[], cwd: string, input?: string) {
    return cli(name, args, cwd, input, this.run);
  }

  protected ok(name: string, args: string[], cwd: string, input?: string) {
    return cliOk(name, args, cwd, input, this.run);
  }

  /** The CLI's JSON output checked against `schema` (#1609): a reply that does not fit fails the call. */
  protected async jsonWith<T>(
    schema: z.ZodType<T>,
    name: string,
    args: string[],
    cwd: string,
    input?: string,
  ): Promise<T> {
    return parseJsonWith(schema, await this.ok(name, args, cwd, input));
  }
}

/**
 * The command line as the parser walks it (#1589 split of `args.ts`): the reader, and the two checks a verb's
 * handler makes on the words after its own.
 */
import { USAGE } from "./usage.ts";

/** Where the parser is in the command line; a handler reads the words after its own through it. */
export class ArgReader {
  private i = 0;
  constructor(private readonly argv: readonly string[]) {}

  /** The word the parser is on, or undefined once the line is read. */
  current(): string | undefined {
    return this.argv[this.i];
  }

  advance(): void {
    this.i++;
  }

  /** The next word, moving onto it. */
  next(): string | undefined {
    return this.argv[++this.i];
  }

  /** The next word, without moving. */
  peek(): string | undefined {
    return this.argv[this.i + 1];
  }

  /** Everything after the current word, which the caller then owns (the parser stops). */
  takeRest(): string[] {
    const rest = this.argv.slice(this.i + 1);
    this.i = this.argv.length;
    return rest;
  }
}

/** The handlers of flags that take no value (`--hold`), kept apart so `--hold=false` and the value-flag list know them (#3425). */
export const FLAGS = new WeakSet<object>();

export const invalid = (what: string, got: string | undefined, none = "(none)") =>
  new Error(`${what}: ${got ?? none}\n${USAGE}`);

/** The word after a command, which must be one of `allowed`. */
export function subAction<T extends string>(
  reader: ArgReader,
  allowed: readonly T[],
  what: string,
  none?: string,
): T {
  const action = reader.next();
  if (action === undefined || !(allowed as readonly string[]).includes(action)) {
    throw invalid(what, action, none);
  }
  return action as T;
}

/** A name after an action (`action run <name>`); it cannot be another flag. */
export function operand(reader: ArgReader, what: string): string {
  const next = reader.next();
  if (next === undefined || next.startsWith("--")) throw new Error(`missing ${what}\n${USAGE}`);
  return next;
}

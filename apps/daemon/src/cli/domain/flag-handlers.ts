/**
 * The two shapes of a flag handler the parser's table is built from (#1589 split of `args.ts`): a flag
 * that takes a value and a flag that takes none. A domain's own table of flags builds its entries with them.
 */
import { type ArgReader, FLAGS } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";

export type Handler = (args: CliArgs, reader: ArgReader, value: () => string) => void;

export const setValue =
  (set: (args: CliArgs, value: string) => void): Handler =>
  (args, _reader, value) => {
    set(args, value());
  };

/** A flag that takes no value: `--hold=false` is an error, never a `--hold` (#3425). */
export const setFlag = (set: (args: CliArgs) => void): Handler => {
  const handler: Handler = (args) => {
    set(args);
  };
  FLAGS.add(handler);
  return handler;
};

/** The commands that take `--confirm` and check it themselves; any other command refuses it as a card flag. */
export const OWN_CONFIRM: ReadonlySet<string> = new Set([
  "rules",
  "autoapprove",
  "team",
  "costs",
  "plugins",
  "ssh",
  "project",
  "runenv",
]);

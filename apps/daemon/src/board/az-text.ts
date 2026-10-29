/**
 * Free text for the Azure CLI (phase 13's `az-cmd`, fixing phase 4). On Windows `az` is a `.cmd`
 * shim, and Bun refuses to pass it an argument with a newline or one of `< > & | ^ "` and `%`;
 * the Azure CLI also reads a local file when an argument is `@file` or `name=@file`, which text
 * from third parties (an issue, a PR comment) must never trigger. So the text that goes to `az`
 * is one clean line, cut to a size, and the other CLIs keep theirs whole.
 */
import { FlightdeckError } from "../errors.ts";

/** Ends a text that was cut: the full one stays on the card. */
export const AZ_CUT_NOTE = "… (descrição completa no card do Flightdeck)";

/** What each refused character becomes: an equivalent that is safe, or nothing. */
const SAFE: Record<string, string> = {
  "<": "(",
  ">": ")",
  "&": "e",
  "|": "/",
  "^": "",
  '"': "'",
  "%": "",
};

/** One safe line of at most `max` characters, ending in the note when it had to be cut. */
export function azText(text: string, max: number): string {
  const line = text
    .trim()
    .replace(/\s*[\r\n]+\s*/g, " — ")
    .replace(/[<>&|^"%]/g, (char) => SAFE[char] as string)
    .replace(/\s+/g, " ")
    .trim()
    // `name=@file` and `@file` make the Azure CLI read that file.
    .replaceAll("=@", "= @");
  const safe = line.startsWith("@") ? ` ${line}` : line;
  const chars = Array.from(safe);
  if (chars.length <= max) return safe;
  const note = Array.from(AZ_CUT_NOTE).length;
  return chars
    .slice(0, max - note)
    .join("")
    .trimEnd()
    .concat(AZ_CUT_NOTE);
}

/** The `az` options that take free text, with the size of what they take. */
export const AZ_TEXT_FLAGS: Record<string, number> = {
  "--title": 200,
  "--description": 400,
  "--discussion": 400,
  "--comment": 400,
  "--content": 400,
};

/**
 * The arguments of an `az` call with its free text made safe. A WIQL is a query, not prose: it
 * only loses its line breaks, and what the `.cmd` still refuses (`<>` in it) fails with a reason.
 */
export function sanitizeAzArgs(args: string[]): string[] {
  return args.map((arg, i) => {
    const flag = args[i - 1];
    if (flag === undefined) return arg;
    const max = AZ_TEXT_FLAGS[flag];
    if (max !== undefined) return azText(arg, max);
    return flag === "--wiql" ? arg.replace(/\s*[\r\n]+\s*/g, " ").trim() : arg;
  });
}

/** Bun's refusal to pass an argument to a `.cmd` becomes an error that says what to change. */
export function mapSpawnError(error: unknown): never {
  if ((error as { code?: string }).code === "ERR_INVALID_ARG_VALUE") {
    throw new FlightdeckError(
      "invalid_state",
      `o az do Windows (um .cmd) recusou um argumento: ${(error as Error).message}. ` +
        'Tire dele as quebras de linha e < > & | ^ " % (numa WIQL, NOT IN no lugar de <>).',
    );
  }
  throw error;
}

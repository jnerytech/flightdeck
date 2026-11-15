/**
 * How a React error becomes one log line (issue #938, #1601): its V8 or JavaScriptCore stack and its
 * component stack, read as plain strings. The app log writes the line; nothing here reads a clock,
 * a store or the DOM.
 */

/** React's own errors: the minified production message, or the development one for a render loop. */
export function isReactError(reason: unknown): boolean {
  return reason instanceof Error && /React error|Maximum update depth/i.test(reason.message);
}

/** What React reports for a component tree error: the component stack, when it gives one. */
export interface ReactErrorInfo {
  componentStack?: string | null;
}

/** How many frames and components a React error's line keeps, and how long each may be. */
const FRAMES = 6;
const COMPONENTS = 8;
const FRAME_CHARS = 100;

/** `Wi (assets/index.js:40:1200)`: the origin says nothing the path does not, so it is cut off. */
const frame = (name: string, where: string): string =>
  `${name} (${where.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*\//i, "")})`.slice(0, FRAME_CHARS);

/**
 * The place of a V8 frame, from what follows `(` or `at`: text with no parenthesis, then at most one
 * `)` and nothing but white space after it. Without the `)` the trailing white space is not part of
 * it (unless that is all there is: its first character stays, as the pattern this replaced kept it).
 */
function placeOf(rest: string): string | null {
  if (rest === "" || rest.includes("(")) return null;
  const close = rest.indexOf(")");
  if (close === -1) return rest.trimEnd() || rest.slice(0, 1);
  if (close === 0 || rest.slice(close + 1).trim() !== "") return null;
  return rest.slice(0, close);
}

/** A V8 frame line (`at Wi (https://host/assets/index.js:40:1200)`), read in one pass. */
function v8Frame(line: string): { name: string | undefined; where: string } | null {
  const at = /^\s*at\s+/y;
  if (!at.test(line)) return null;
  const rest = line.slice(at.lastIndex);
  const token = /^\S+/.exec(rest)?.[0];
  if (token !== undefined) {
    const opening = /^\s+\(/.exec(rest.slice(token.length));
    const inside = opening ? placeOf(rest.slice(token.length + opening[0].length)) : null;
    if (inside !== null) return { name: token, where: inside };
  }
  // The pattern gave back the last white space of `at  ` to the place when that was all that fit.
  const gaveBack = /\s\s$/.test(line.slice(0, at.lastIndex));
  const where = placeOf(rest) ?? (gaveBack ? placeOf(line.slice(at.lastIndex - 1)) : null);
  return where === null ? null : { name: undefined, where };
}

/** A frame from a V8 line (`at Wi (https://host/assets/index.js:40:1200)`) or a JavaScriptCore one (`Wi@https://host/assets/index.js:40:1200`). */
function frameOf(line: string): string | null {
  const v8 = v8Frame(line);
  if (v8) return frame(v8.name ?? "<anonymous>", v8.where);
  const jsc = /^([^@\s]*)@(.+)$/.exec(line.trim());
  return jsc ? frame(jsc[1] || "<anonymous>", jsc[2] ?? "") : null;
}

/**
 * One line that places a React error (issue #938): the first frames of its stack, the components
 * React names, and the screen the person was on. Names of functions, files of the app and the
 * route's name only; the log scrubs secrets from it anyway.
 */
export function reactErrorLine(error: unknown, info: ReactErrorInfo, screen: string): string {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error && typeof error.stack === "string" ? error.stack : "";
  const frames = stack
    .split("\n")
    .map(frameOf)
    .filter((frame): frame is string => frame !== null)
    .slice(0, FRAMES);
  const components = (info.componentStack ?? "")
    .split("\n")
    .map((line) => /^\s*at\s+(\S+)/.exec(line)?.[1])
    .filter((name): name is string => name !== undefined)
    .slice(0, COMPONENTS);
  return [
    message,
    `screen: ${screen}`,
    ...(frames.length > 0 ? [`frames: ${frames.join(" < ")}`] : []),
    ...(components.length > 0 ? [`components: ${components.join(" < ")}`] : []),
  ].join(" | ");
}

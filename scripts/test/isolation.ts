/**
 * Shared globals a test file can leave changed for the next one (issue #274): the timers, `Date`,
 * `fetch`, the environment and, once happy-dom is registered, the window size, the browser storage
 * and the page body. `captureGlobals` takes them as the preload leaves them; `restoreGlobals` puts
 * them back between two files and names what had leaked.
 */

/** What the isolation looks at: the real `globalThis`, or a stand-in in a test. */
// biome-ignore lint/suspicious/noExplicitAny: a global scope has no useful type
export type Scope = Record<string, any>;

export interface Snapshot {
  /** The environment, copied. */
  env: Record<string, string | undefined>;
  /** The replaceable members of the scope, by name. */
  members: Record<string, unknown>;
}

/** Members a test replaces to control time or the network. */
const MEMBERS = [
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "setImmediate",
  "clearImmediate",
  "Date",
  "fetch",
];

/** The window size: happy-dom keeps an assigned value in front of its viewport. */
const SIZE_MEMBERS = ["innerWidth", "innerHeight", "outerWidth", "outerHeight"];

/** Take the globals as they are now. */
export function captureGlobals(scope: Scope = globalThis): Snapshot {
  const members: Record<string, unknown> = {};
  for (const name of MEMBERS) members[name] = scope[name];
  return { env: { ...scope.process.env }, members };
}

function restoreEnv(snapshot: Snapshot, scope: Scope, leaked: string[]): void {
  const env = scope.process.env;
  for (const key of new Set([...Object.keys(env), ...Object.keys(snapshot.env)])) {
    if (env[key] === snapshot.env[key]) continue;
    leaked.push(`env.${key}`);
    if (snapshot.env[key] === undefined) delete env[key];
    else env[key] = snapshot.env[key];
  }
}

function restoreWindow(scope: Scope, leaked: string[]): void {
  const win = scope.window;
  if (!win?.happyDOM) return;
  for (const name of SIZE_MEMBERS) {
    const before = win[name];
    // Assigning null hands the member back to the viewport.
    win[name] = null;
    if (win[name] !== before) leaked.push(name);
  }
  for (const name of ["localStorage", "sessionStorage"]) {
    if (scope[name]?.length > 0) {
      scope[name].clear();
      leaked.push(name);
    }
  }
  const body = scope.document?.body;
  if (body && body.innerHTML !== "") {
    body.innerHTML = "";
    leaked.push("document.body");
  }
}

/** Put the globals back as `snapshot` has them; returns the names that had changed. */
export function restoreGlobals(snapshot: Snapshot, scope: Scope = globalThis): string[] {
  const leaked: string[] = [];
  for (const name of MEMBERS) {
    const want = snapshot.members[name];
    if (scope[name] === want) continue;
    scope[name] = want;
    leaked.push(name);
  }
  restoreEnv(snapshot, scope, leaked);
  restoreWindow(scope, leaked);
  return leaked;
}

/** What nearly every UI file leaves behind and the next one never notices: reset without a word. */
const ROUTINE = new Set([...SIZE_MEMBERS, "localStorage", "sessionStorage", "document.body"]);

/**
 * Before each test file loads (Bun runs files one after the other: load, run, next), puts the
 * globals back as the last file's top-level code left them. That is the baseline, taken right after a
 * file has loaded (a call appended to its source): a helper that sets an environment variable or
 * registers happy-dom when it loads runs once, and the files after the first that imported it
 * still need what it set. Only what the tests and hooks of a file change is put back. A leak other
 * than the routine browser state is named on stderr with the file that left it, so the culprit is
 * one line away.
 */
export function installBetweenFiles(
  snapshot: Snapshot,
  warn: (line: string) => void = (line) => console.error(line),
): void {
  let baseline = snapshot;
  let previous = "";
  const hook = "__flightdeckAfterLoad";
  (globalThis as Scope)[hook] = () => {
    baseline = captureGlobals();
  };
  Bun.plugin({
    name: "flightdeck-isolation",
    setup(build) {
      build.onLoad({ filter: /\.test\.tsx?$/ }, async (args) => {
        const leaked = restoreGlobals(baseline).filter((name) => !ROUTINE.has(name));
        if (previous && leaked.length > 0) {
          warn(
            `isolation: ${previous} left ${leaked.join(", ")} changed; put back before ${args.path}`,
          );
        }
        previous = args.path;
        const source = await Bun.file(args.path).text();
        return {
          contents: `${source}\n;globalThis.${hook}?.();\n`,
          loader: args.path.endsWith("x") ? "tsx" : "ts",
        };
      });
    },
  });
}

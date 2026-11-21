/**
 * Issue #3617: what the `agentcfg` verbs of the CLI take, checked before anything is sent. The parser in
 * `args.ts` adds the usage text to the problem this names.
 */
import { AgentCfgKind } from "@flightdeck/protocol";
import type { AgentcfgCliArgs } from "../../agentcfg/index.ts";
import { type ArgReader, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";
import { type Handler, setFlag } from "./flag-handlers.ts";
import { oneOf } from "./vault-args.ts";

const ACTIONS = ["list", "read", "write"] as const;
const ORIGINS = ["project", "user"] as const;
export const SHA256 = /^[0-9a-f]{64}$/;

/** `agentcfg list|read|write <project>`. */
export function readAgentcfg(args: CliArgs, reader: ArgReader): void {
  args.command = "agentcfg";
  args.action = subAction(reader, ACTIONS, "invalid agentcfg action");
  const words: string[] = [];
  while (reader.peek() !== undefined && !(reader.peek() ?? "").startsWith("--")) {
    reader.advance();
    words.push(reader.current() ?? "");
  }
  args.agentcfgWords = words;
}

/** The flags only `agentcfg` takes, for the parser's table of flags. */
export const AGENTCFG_FLAGS: Record<string, Handler> = {
  "--kind": (args, _reader, value) => {
    args.agentcfgKind = oneOf("--kind", value(), AgentCfgKind.options);
  },
  "--path": (args, _reader, value) => {
    args.pathFlag = value();
  },
  "--file": (args, _reader, value) => {
    args.agentcfgFile = value();
  },
  "--expected-hash": (args, _reader, value) => {
    args.agentcfgHash = value();
  },
  "--new": setFlag((args) => {
    args.agentcfgNew = true;
  }),
};

/** Every flag of the verbs, whether it was typed, and the verbs that take it. */
const flagged = (args: CliArgs): Array<[string, boolean, readonly string[]]> => [
  ["--kind", args.agentcfgKind !== undefined, ACTIONS],
  ["--path", args.pathFlag !== undefined, ["read", "write"]],
  ["--file", args.agentcfgFile !== undefined, ["write"]],
  ["--expected-hash", args.agentcfgHash !== undefined, ["write"]],
  ["--new", args.agentcfgNew === true, ["write"]],
];

/** The flags other commands read too: on `agentcfg` only, they are checked here. */
const SHARED: Array<[string, (args: CliArgs) => boolean, readonly string[]]> = [
  ["--origin", (args) => args.origin !== undefined, ["read", "write"]],
  ["--confirm", (args) => args.confirm !== undefined, ["write"]],
];

/** `--path` is also `review add`'s, and `--file`, `--expected-hash` and `--new` are `memory`'s: each checks its own flags. */
const checkedElsewhere = (args: CliArgs, flag: string): boolean =>
  (flag === "--path" && args.command === "review") ||
  (args.command === "memory" && ["--file", "--expected-hash", "--new"].includes(flag));

/** A flag outside the verbs that take it. */
function strayFlag(args: CliArgs): string | undefined {
  const onAgentcfg = args.command === "agentcfg";
  for (const [flag, typed, verbs] of flagged(args))
    if (
      typed &&
      !(onAgentcfg && verbs.includes(args.action ?? "")) &&
      !checkedElsewhere(args, flag)
    )
      return `${flag}: this flag only applies to flightdeckd agentcfg ${verbs.join(", ")}`;
  if (!onAgentcfg) return undefined;
  for (const [flag, typed, verbs] of SHARED)
    if (typed(args) && !verbs.includes(args.action ?? ""))
      return `${flag}: on agentcfg this flag only applies to ${verbs.join(" and ")}`;
  return undefined;
}

/** What `agentcfg write` needs besides the project: where the content comes from, which version it replaces, and `--confirm`. */
function writeProblem(args: CliArgs): string | undefined {
  if (args.agentcfgFile === undefined)
    return "agentcfg write: missing --file <path> (or --file - for standard input)";
  const hash = args.agentcfgHash;
  if (hash !== undefined && args.agentcfgNew)
    return "agentcfg write: --expected-hash and --new cannot go together";
  if (hash === undefined && !args.agentcfgNew)
    return "agentcfg write: missing --expected-hash <hash> (the one agentcfg read printed), or --new for a file that must not exist yet";
  if (hash !== undefined && !SHA256.test(hash))
    return "--expected-hash: a sha256 hash of 64 hex digits, as agentcfg read prints it";
  if (args.confirm !== true)
    return "agentcfg write: needs --confirm, since it replaces a file the project's sessions read";
  return undefined;
}

/**
 * What is wrong with the `agentcfg` words and flags: a flag outside the verbs that take it, no project or
 * more than one, no `--kind`, a read or write with no `--path`, an origin the daemon has no files for, and
 * a write that does not say where its content comes from, which version it replaces, or `--confirm`.
 */
export function agentcfgProblem(args: CliArgs): string | undefined {
  const stray = strayFlag(args);
  if (stray !== undefined || args.command !== "agentcfg") return stray;
  const verb = `agentcfg ${args.action}`;
  const words = args.agentcfgWords ?? [];
  if (words.length === 0) return `${verb}: missing the project (a name or id)`;
  if (words.length > 1) return `${verb}: give one project, got ${words.length}`;
  if (args.agentcfgKind === undefined)
    return `${verb}: missing --kind <${AgentCfgKind.options.join("|")}>`;
  if (args.action === "list") return undefined;
  if (args.pathFlag === undefined) return `${verb}: missing --path <file>`;
  if (args.origin !== undefined && !(ORIGINS as readonly string[]).includes(args.origin))
    return `--origin: ${ORIGINS.join(" or ")}, got ${args.origin}`;
  return args.action === "write" ? writeProblem(args) : undefined;
}

/** What the agentcfg runner takes from the parsed arguments (checked by `agentcfgProblem`). */
export function agentcfgCliArgs(args: CliArgs): AgentcfgCliArgs {
  const common = {
    project: args.agentcfgWords?.[0] ?? "",
    kind: args.agentcfgKind as NonNullable<CliArgs["agentcfgKind"]>,
    ...(args.json ? { json: true as const } : {}),
  };
  const path = args.pathFlag ?? "";
  // The values of `--origin` were checked above: the daemon's two, not the history's.
  const origin = args.origin as "project" | "user" | undefined;
  if (args.action === "read")
    return { action: "read", ...common, path, ...(origin ? { origin } : {}) };
  if (args.action === "write")
    return {
      action: "write",
      ...common,
      path,
      file: args.agentcfgFile ?? "",
      expectedHash: args.agentcfgHash ?? null,
      confirm: true,
      ...(origin ? { origin } : {}),
    };
  return { action: "list", ...common };
}

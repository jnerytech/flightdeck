/**
 * Issue #3458: what the `vault` verbs of the CLI take, checked before anything is sent. The parser in
 * `args.ts` adds the usage text to the problem this names. The words and ranges are the protocol's and
 * are checked as each flag is read; this is which verb takes which flag, and what a verb needs.
 */

/** The parsed arguments this check reads: `CliArgs` fits it. */
export interface VaultArgs {
  command: string;
  action?: string;
  days?: number;
  limit?: number;
  csv?: boolean;
  requester?: string;
  purpose?: string;
  useAction?: string;
  host?: string;
  project?: string;
  session?: string;
  tags?: string[];
  risk?: string;
  approval?: string;
  at?: number;
}

const PREVIEW = ["preview"] as const;

/** The flags of `vault`, each with the verbs that take it; `shared` ones belong to other commands too, so only `vault` is checked for them. */
function vaultFlags(args: VaultArgs): Array<[string, unknown, readonly string[], boolean]> {
  return [
    ["--days", args.days, ["decisions", "report"], false],
    ["--csv", args.csv, ["report"], false],
    ["--requester", args.requester, PREVIEW, false],
    ["--purpose", args.purpose, PREVIEW, false],
    ["--action", args.useAction, PREVIEW, false],
    ["--tag", args.tags, PREVIEW, false],
    ["--risk", args.risk, PREVIEW, false],
    ["--approval", args.approval, PREVIEW, false],
    ["--at", args.at, PREVIEW, false],
    ["--limit", args.limit, ["decisions"], true],
    ["--host", args.host, PREVIEW, true],
    ["--project", args.project, PREVIEW, true],
    ["--session", args.session, PREVIEW, true],
  ];
}

/** `preview` is typed `rules preview`. */
const typed = (verb: string) => (verb === "preview" ? "rules preview" : verb);

/** What is wrong with the `vault` flags: one of another verb or command, or a use that lacks what the daemon needs. */
export function vaultProblem(args: VaultArgs): string | undefined {
  for (const [flag, value, verbs, shared] of vaultFlags(args)) {
    if (value === undefined || (shared && args.command !== "vault")) continue;
    if (args.command !== "vault" || !verbs.includes(args.action as string))
      return `${flag}: this flag only applies to flightdeckd vault ${verbs.map(typed).join(", ")}`;
  }
  if (args.command === "vault" && args.action === "preview") {
    if (args.requester === undefined) return "--requester: needed, who asks to use the secret";
    if (args.purpose === undefined) return "--purpose: needed, what the secret is for";
  }
  return undefined;
}

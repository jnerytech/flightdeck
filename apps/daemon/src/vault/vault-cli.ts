/**
 * Issue #3458: `flightdeckd vault decisions|report|rules`, the vault's audit and rules from a terminal or
 * a script. It speaks to the local daemon like `flightdeckd card` does (the same `DaemonClient`, the
 * token of the config). Exit codes: 0 done, 1 refused, 2 no daemon. Only `deny` writes, so only its answer
 * can be "unsure"; none of the verbs prints a secret value or a webhook URL, which these answers do not hold.
 */
import type { VaultRequestFrame, VaultUsed } from "@flightdeck/protocol";
import {
  type CliResult,
  failure,
  json,
  runOnLocalDaemon,
  said,
  shown,
  streamFrames,
} from "../daemon-client/index.ts";
import {
  decisionLine,
  reportLine,
  requestLine,
  ruleLines,
  usedLine,
  type VaultCliArgs,
  verdictLine,
} from "./domain/vault-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

/** What the person typed and nothing else: the daemon has its own defaults. */
function given<T extends Record<string, unknown>>(fields: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

export async function runVaultCli(
  args: VaultCliArgs,
  config: { bind: string; port: number; token: string },
  options: {
    timeoutMs?: number;
    /** `watch` stops when this aborts (Ctrl-C). */
    signal?: AbortSignal;
    /** `watch` writes each line here as it comes. */
    write?: (line: string) => void;
  } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    clientName: "flightdeck-vault",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    unsure:
      "; the request may or may not have been denied: look at the app, or run `vault watch`, before trying again",
    perform: async (daemon, note, flow) => {
      switch (args.action) {
        case "decisions": {
          const { secretId, days, limit } = args;
          const answer = await daemon.call("vault.decisions", given({ secretId, days, limit }));
          return shown(args.json, answer, (found) =>
            found.decisions.length ? found.decisions.map(decisionLine) : ["no decisions"],
          );
        }
        case "report": {
          const { days, csv } = args;
          const answer = await daemon.call("vault.report", {
            ...given({ days }),
            ...(csv ? { format: "csv" as const } : {}),
          });
          return shown(args.json, answer, (found) => reportOut(found, csv));
        }
        case "watch":
          return streamFrames({
            daemon,
            flow,
            ...options,
            open: () => daemon.call("vault.watch", {}),
            type: ["vault.request", "vault.used"],
            line: (frame) => (args.json ? JSON.stringify(frame) : watchLine(frame)),
          });
        case "deny": {
          note.wrote = true;
          const answer = await daemon.call("vault.deny", { requestId: args.requestId });
          // A daemon from before the answer carried `denied` acks with no data at all: its word stands.
          if (answer?.denied === false)
            return failure(
              1,
              `request ${args.requestId} is not waiting: it was answered, expired or never existed`,
            );
          return args.json
            ? json({ requestId: args.requestId, denied: true })
            : said(`denied ${args.requestId}`);
        }
        case "rules":
          return shown(
            args.json,
            await daemon.call("vault.rules.get", { secretId: args.secretId }),
            ruleLines,
          );
        default:
          return shown(
            args.json,
            await daemon.call("vault.rules.preview", previewOf(args)),
            (v) => [verdictLine(v)],
          );
      }
    },
  });
}

/** One line of `vault watch`: a request that asks or is let through, or a use of a delivered secret. */
function watchLine(frame: VaultRequestFrame | VaultUsed): string {
  return frame.type === "vault.request" ? requestLine(frame) : usedLine(frame);
}

/** The lines of a report: the CSV the app saves (its own line breaks stay, one output line each), else a line per use. */
function reportOut(
  answer: { csv?: string; rows: Parameters<typeof reportLine>[0][] },
  csv: boolean | undefined,
): string[] {
  if (csv && answer.csv !== undefined) return answer.csv.split(/\r\n|\r|\n/);
  return answer.rows.length ? answer.rows.map(reportLine) : ["no uses"];
}

/** What a rules preview asks: the use to judge, and only the fields the person gave. */
function previewOf(args: Extract<VaultCliArgs, { action: "preview" }>) {
  const { secretId, requester, purpose, useAction, host, project, session, tags, risk } = args;
  return {
    secretId,
    requester,
    purpose,
    ...given({
      action: useAction,
      host,
      project,
      session,
      tags,
      risk,
      actionApproval: args.approval,
      at: args.at,
    }),
  };
}

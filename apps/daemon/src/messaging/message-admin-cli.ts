/**
 * Issue #3622: `flightdeckd message history|watch|rules`, the messages between sessions and the rules
 * that govern them, from a terminal or a script. It speaks to the local daemon (or the host `--host`
 * names) like `flightdeckd send` does. Exit codes: 0 done, 1 refused, 2 no daemon. `watch` is a stream
 * (docs/decisions/2026-11-20-cli-streams.md): it runs until Ctrl-C.
 */
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  type CliResult,
  failure,
  json,
  type RemoteTarget,
  runOnLocalDaemon,
  said,
  streamFrames,
} from "../daemon-client/index.ts";
import { parseJsonWith } from "../kernel/index.ts";
import {
  frameLine,
  historyLines,
  listPayload,
  type MessageAdminCliArgs,
  type MessageFrame,
  rulesLines,
  WATCH_FRAMES,
} from "./domain/message-admin-view.ts";

export type { MessageAdminCliArgs } from "./domain/message-admin-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

const UNSURE_RULES =
  "; the rules may or may not have changed: run flightdeckd message rules to see them";

/** The policy a `rules-set` file or standard input holds (`-`): an object, which the daemon then validates. */
async function policyOf(
  source: string,
  stdin: () => ReadableStream<Uint8Array>,
): Promise<Record<string, unknown> | null> {
  try {
    const body =
      source === "-" ? await new Response(stdin()).text() : await readFile(source, "utf8");
    return parseJsonWith(z.record(z.string(), z.unknown()), body);
  } catch {
    return null;
  }
}

export async function runMessageAdminCli(
  args: MessageAdminCliArgs,
  config: { bind: string; port: number; token: string },
  options: {
    timeoutMs?: number;
    remote?: RemoteTarget;
    /** `watch` stops when this aborts (Ctrl-C). */
    signal?: AbortSignal;
    /** `rules-set --policy-file -` reads the policy from here. */
    stdin?: ReadableStream<Uint8Array> | undefined;
    /** `watch` writes each line here as it comes. */
    write?: (line: string) => void;
  } = {},
): Promise<CliResult> {
  let policy: Record<string, unknown> = {};
  if (args.action === "rules-set") {
    const source = args.policyFile ?? "";
    const read = await policyOf(source, () => options.stdin ?? Bun.stdin.stream());
    if (read === null)
      return failure(
        1,
        `message rules-set: cannot read a policy object from ${source === "-" ? "standard input" : source}`,
      );
    policy = read;
  }
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-message",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    // Only `rules-set` writes: a silent daemon changed nothing for the others.
    unsure: args.action === "rules-set" ? UNSURE_RULES : "",
    perform: async (daemon, note, flow) => {
      switch (args.action) {
        case "watch":
          return streamFrames({
            daemon,
            flow,
            signal: options.signal ?? new AbortController().signal,
            write: options.write ?? (() => undefined),
            open: () => daemon.call("messages.watch", {}),
            type: WATCH_FRAMES,
            line: (frame) => (args.json ? JSON.stringify(frame) : frameLine(frame as MessageFrame)),
          });
        case "rules": {
          const rules = await daemon.call("messaging.rules.get", {});
          return args.json ? json(rules) : said(...rulesLines(rules));
        }
        case "rules-set": {
          note.wrote = true;
          const set = await daemon.call("messaging.rules.set", {
            policy,
            ...(args.unpause?.length ? { unpause: args.unpause } : {}),
          });
          return args.json ? json(set) : said(...rulesLines(set));
        }
        case "history": {
          const answer = await daemon.call("messages.list", listPayload(args));
          return args.json ? json(answer) : said(...historyLines(answer.messages));
        }
      }
    },
  });
}

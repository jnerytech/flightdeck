/**
 * Issue #3704: `flightdeckd session teleport`, the CLI's side of moving a session to another host. The
 * source is the local daemon (or the host `--host` names), the target a host reached by name. The move
 * itself is the relay the app shares (`teleportSession`); this connects both hosts, asks `--confirm`
 * where the app asks its dialog, and words every way it can stop. Exit codes: 0 moved, 1 refused or
 * stopped, 2 no daemon.
 */
import {
  type TeleportCommands,
  type TeleportManifest,
  type TeleportRequest,
  teleportSession,
} from "@flightdeck/protocol";
import {
  type CliResult,
  DaemonClient,
  DaemonRefusal,
  explainRemote,
  failure,
  json,
  plain,
  type RemoteTarget,
  resolveSession,
  runOnLocalDaemon,
  said,
  TimedOut,
} from "../daemon-client/index.ts";
import {
  importUnsure,
  movedLine,
  packageRefusal,
  prepareRefusal,
  progressLine,
  summaryJson,
  summaryLines,
} from "./domain/teleport-cli-view.ts";

interface TeleportCliArgs {
  /** The session on the source host, its name or its id. */
  session: string;
  /** The project on the target host the session lands in. */
  repo: string;
  confirm: boolean;
  json?: boolean;
}

interface TeleportCliOptions {
  /** The target host, reached by name; the source is the local daemon, or `remote`. */
  target: RemoteTarget;
  remote?: RemoteTarget;
  /** Ctrl-C: aborts the move and frees both hosts. */
  signal?: AbortSignal;
  /** How long one request has to answer. */
  stepMs?: number;
  cleanupMs?: number;
  /** Where a progress line goes while the move runs (stderr); none under `--json`. */
  write?: (line: string) => void;
}

const STEP_MS = 60_000;
const CONNECT_MS = 10_000;
/** The import is the one step that works on the target before it answers: it has this many steps. */
const FINISH_STEPS = 5;
const CANCELLED = "cancelled: nothing moved";

type Side = "source" | "target";

/** A request of one host that failed, with the host and the call it was; the runner words it. */
class HostError extends Error {
  constructor(
    readonly side: Side,
    readonly call: string,
    override readonly cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
  }
}

/** The source sent a package the relay refuses. */
class PackageRefused extends Error {
  constructor(readonly why: "teleport_corrupt" | "teleport_incomplete") {
    super(why);
  }
}

/** Ctrl-C came while a step the relay does not run was waiting. */
class Stopped extends Error {}

/** `work`, or a `Stopped` when the signal aborts first: Ctrl-C never waits for a host that is slow to answer. */
function unlessStopped<T>(signal: AbortSignal | undefined, work: Promise<T>): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(new Stopped());
    const stop = () => reject(new Stopped());
    signal.addEventListener("abort", stop, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
  });
}

/** `work`, or a `TimedOut` when it takes longer than `ms`; the timer never outlives the answer. */
async function within<T>(ms: number, work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clock = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimedOut()), ms);
  });
  try {
    return await Promise.race([work, clock]);
  } finally {
    clearTimeout(timer);
  }
}

/** Connects to the target by name: nothing is sent to a host that does not answer in time. */
async function connectTarget(
  target: RemoteTarget,
  ms: number,
  signal: AbortSignal | undefined,
): Promise<DaemonClient> {
  const giveUp = new AbortController();
  try {
    return await unlessStopped(
      signal,
      within(
        ms,
        DaemonClient.connect(target.url, target.token(), "flightdeck-teleport", giveUp.signal),
      ),
    );
  } catch (error) {
    giveUp.abort();
    throw error;
  }
}

export function runTeleportCli(
  args: TeleportCliArgs,
  config: { bind: string; port: number; token: string },
  options: TeleportCliOptions,
): Promise<CliResult> {
  const { target, remote, signal } = options;
  const stepMs = options.stepMs ?? STEP_MS;
  const sourceName = remote?.name ?? "this host";
  const targetToken = target.token();
  const hideTarget = (text: string) => text.split(targetToken).join("[token]");
  const progress = args.json ? undefined : options.write;

  return runOnLocalDaemon({
    config,
    remote,
    clientName: "flightdeck-teleport",
    timeoutMs: CONNECT_MS,
    perform: async (daemon, _note, flow) => {
      // The connection is made: from here a request has `stepMs`, not the time to connect.
      flow.started();
      let targetClient: DaemonClient | undefined;
      try {
        targetClient = await connectTarget(target, Math.min(stepMs, CONNECT_MS), signal);
      } catch (error) {
        if (error instanceof Stopped) return failure(1, CANCELLED);
        return explainRemote(
          error,
          { name: target.name, timeoutMs: CONNECT_MS, unsure: "" },
          hideTarget,
        );
      }
      const asking = (client: DaemonClient, side: Side): TeleportRequest => {
        return (async <T extends keyof TeleportCommands>(
          type: T,
          payload: TeleportCommands[T][0],
        ) => {
          try {
            return (await within(
              type === "teleport.finish" ? stepMs * FINISH_STEPS : stepMs,
              (client.call as (t: string, p: unknown) => Promise<unknown>)(type, payload),
            )) as TeleportCommands[T][1];
          } catch (error) {
            throw new HostError(side, type, error);
          }
        }) as TeleportRequest;
      };
      let manifest: TeleportManifest | undefined;
      const fromSource = asking(daemon, "source");
      const source = (async (type: keyof TeleportCommands, payload: never) => {
        const answer = await fromSource(type, payload);
        if (type === "teleport.prepare") manifest = answer as TeleportManifest;
        return answer;
      }) as TeleportRequest;
      const lines: string[] = [];
      let sessionName = args.session;
      try {
        const listed = await unlessStopped(
          signal,
          within(stepMs, daemon.call("session.list", {})),
        ).catch((error) => {
          throw error instanceof Stopped ? error : new HostError("source", "session.list", error);
        });
        const found = resolveSession(listed.sessions, args.session);
        if ("refusal" in found) return found.refusal;
        sessionName = listed.sessions.find((s) => s.id === found.id)?.name || found.id;
        const outcome = await teleportSession({
          source,
          target: asking(targetClient, "target"),
          sessionId: found.id,
          repo: args.repo,
          signal,
          cleanupMs: options.cleanupMs,
          onProgress: progress ? (sent, total) => progress(progressLine(sent, total)) : undefined,
          refuse: (why) => new PackageRefused(why),
          confirm: async () => {
            if (manifest) lines.push(...summaryLines(sessionName, target.name, manifest));
            return args.confirm;
          },
        });
        if (outcome.kind === "cancelled") return failure(1, CANCELLED);
        if (outcome.kind === "declined")
          return notConfirmed(args, found.id, target.name, manifest, lines);
        // What the target answers is its own text: its token never reaches a line.
        const landed = {
          sessionId: hideTarget(outcome.sessionId),
          worktree: hideTarget(outcome.worktree),
          branch: hideTarget(outcome.branch),
        };
        if (args.json) {
          return json({
            moved: true,
            id: manifest?.id,
            sessionId: landed.sessionId,
            claudeSessionId: manifest?.claudeSessionId,
            target: target.name,
            worktree: landed.worktree,
            branch: landed.branch,
          });
        }
        return said(...lines, movedLine(sessionName, target.name, landed));
      } catch (error) {
        return explain(error, {
          sourceName,
          target: target.name,
          stepMs,
          session: sessionName,
          hideTarget,
        });
      } finally {
        targetClient.close();
      }
    },
  });
}

/** Without `--confirm` nothing moves: what would, and the way to say yes. The package is dropped by the relay. */
function notConfirmed(
  args: TeleportCliArgs,
  sessionId: string,
  target: string,
  manifest: TeleportManifest | undefined,
  lines: string[],
): CliResult {
  const hint = `nothing moved: run it again with --confirm to move the session to ${target}`;
  if (args.json && manifest) {
    return {
      ...json({
        moved: false,
        id: manifest.id,
        sessionId,
        claudeSessionId: manifest.claudeSessionId,
        target,
        summary: summaryJson(manifest),
      }),
      code: 1,
      reason: "not_confirmed",
    };
  }
  return { code: 1, out: lines.map(plain), err: [plain(hint)], reason: "not_confirmed" };
}

/** What stopped the move, as an exit code and a line a person acts on; a token never reaches it. */
function explain(
  error: unknown,
  context: {
    sourceName: string;
    target: string;
    stepMs: number;
    session: string;
    hideTarget: (text: string) => string;
  },
): CliResult {
  if (error instanceof Stopped) return failure(1, CANCELLED);
  if (error instanceof PackageRefused) return failure(1, packageRefusal(error.why), error.why);
  if (!(error instanceof HostError)) throw error;
  const { side, call, cause } = error;
  const name = side === "target" ? context.target : context.sourceName;
  if (cause instanceof DaemonRefusal) {
    const text =
      side === "source" && call === "teleport.prepare"
        ? prepareRefusal(context.session, cause.reason, cause.detail)
        : cause.detail;
    return failure(
      1,
      side === "target" ? `${name}: ${context.hideTarget(text)}` : text,
      cause.reason,
    );
  }
  // The import is the one request whose silence leaves the result unknown.
  if (side === "target" && call === "teleport.finish") {
    return failure(1, importUnsure(context.target), "import_unsure");
  }
  if (side === "target") {
    return explainRemote(
      cause,
      { name, timeoutMs: context.stepMs, unsure: "" },
      context.hideTarget,
    );
  }
  // A step that stalled is worded with the step's own seconds, not the connect's.
  if (cause instanceof TimedOut) {
    const seconds = Math.ceil(context.stepMs / 1000);
    return failure(2, `${name} did not answer ${call} in ${seconds} s`, "unreachable");
  }
  // The source: the caller's own explanation of a daemon that went (exit 2) is what `runOnLocalDaemon` gives.
  throw cause;
}

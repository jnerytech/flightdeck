/** What a print's socket wrapper does with each frame (#1414). */
export interface FrameRewriter {
  /** A frame the app sends: a `resources.get` or `budget.list` request is noted by its id. The frame that goes to the host comes back (#3982: a rewriter may send another). */
  fromApp(frame: string): string;
  /** A frame the host sends: the answer to a noted request comes back rewritten. */
  fromHost(frame: string): string;
  /** A host frame the app never hears, such as the answer of a command left pending (#4001). */
  drops?(frame: string): boolean;
  /** Frames the host seems to send right after `frame`, which the app hears once it heard `frame` (#3943). */
  followUp?(frame: string): string[];
  /** The host's answer to a frame the app sends, when the print answers for it: the frame then never leaves the page (#3987). */
  answer?(frame: string): string | undefined;
  /** A frame the app sends that never leaves the page and is never answered: the command stays pending (#4203). */
  swallows?(frame: string): boolean;
}

type Data = Record<string, unknown> & { memory?: { totalBytes?: number }; budgets?: unknown[] };

/**
 * The demo's hosts read the machine's own memory and keep their budgets far from the limit, so a
 * print would show neither hold. The print of Start N's confirm wraps the page's sockets with this:
 * the host's answer to `resources.get` reads `used` of its memory in use with the hold at `pauseAt`,
 * and its answer to `budget.list` gains a host budget that holds new cards, at its limit.
 *
 * It goes into the page as its source (`holdsScript`), so it uses nothing outside its own body.
 */
// Not instrumented: its source goes into the page, where an istanbul counter would not exist
// (the istanbul shard of a full run, #1492).
/* istanbul ignore next */
export function holdsRewriter(used = 0.95, pauseAt = 0.9): FrameRewriter {
  const parse = (frame: string): Record<string, unknown> | null => {
    try {
      const value: unknown = JSON.parse(frame);
      return typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };
  const holding = {
    id: "print-hold",
    scope: "host",
    projectKey: null,
    period: "day",
    limitUsd: 20,
    limitPct: null,
    action: "queue",
    createdAt: "2026-11-09T08:00:00.000Z",
    periodKey: "2026-11-09",
    spentUsd: 20,
    spentPct: null,
    estimated: false,
    fraction: 1,
    crossed: [0.5, 0.8, 1],
  };
  const rewrite: Record<string, (data: Data) => Data> = {
    "resources.get": (data) => {
      const total = data.memory?.totalBytes ?? 0;
      const memory = {
        ...data.memory,
        totalBytes: total,
        freeBytes: Math.round(total * (1 - used)),
      };
      return { ...data, memory, memoryPauseAt: pauseAt, memoryHolding: true };
    },
    "budget.list": (data) => ({ ...data, budgets: [...(data.budgets ?? []), holding] }),
  };
  const asked = new Map<string, string>();
  return {
    fromApp(frame) {
      const message = parse(frame);
      const type = message?.type;
      if (typeof type === "string" && type in rewrite && typeof message?.id === "string") {
        asked.set(message.id, type);
      }
      return frame;
    },
    fromHost(frame) {
      const message = parse(frame);
      const id = message?.id;
      const type = typeof id === "string" ? asked.get(id) : undefined;
      if (message?.type !== "ack" || typeof id !== "string" || type === undefined) return frame;
      asked.delete(id);
      if (message.ok !== true) return frame;
      const data = rewrite[type]?.((message.data ?? {}) as Data);
      return JSON.stringify({ ...message, data });
    },
  };
}

/**
 * Wraps `target.WebSocket` so each socket's frames go through a rewriter `make` builds from the socket's url (#4194): what the app
 * sends is noted, and its `message` listeners get the host's frames rewritten. Runs in the page.
 */
// Not instrumented: its source goes into the page, where an istanbul counter would not exist
// (the istanbul shard of a full run, #1492).
/* istanbul ignore next */
export function installHolds(
  target: { WebSocket: typeof WebSocket },
  make: (url: string) => FrameRewriter,
): void {
  const Base = target.WebSocket;
  /** The listen of the base class, called with the wrapped listener. */
  const listen = Base.prototype.addEventListener as (
    this: WebSocket,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) => void;
  class Held extends Base {
    readonly rewriter = make(this.url);
    /** What the app's message listeners hear, to give them an answer the print makes in the host's place. */
    readonly hear: Array<(data: string) => void> = [];
    override send(data: Parameters<WebSocket["send"]>[0]): void {
      const sent = typeof data === "string" ? this.rewriter.fromApp(data) : data;
      if (typeof sent === "string") {
        const answer = this.rewriter.answer?.(sent);
        if (answer !== undefined) {
          // Never sent: the host would do what the print only shows (#3987).
          queueMicrotask(() => {
            for (const listener of this.hear) listener(answer);
          });
          return;
        }
      }
      if (typeof sent === "string" && this.rewriter.swallows?.(sent)) return;
      super.send(sent);
    }
    override addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ): void {
      if (type !== "message" || typeof listener !== "function") {
        listen.call(this, type, listener, options);
        return;
      }
      this.hear.push((data) => listener.call(this, new MessageEvent("message", { data })));
      const rewritten = (event: Event) => {
        const data = (event as MessageEvent).data;
        if (typeof data !== "string") return listener.call(this, event);
        if (this.rewriter.drops?.(data)) return undefined;
        const answer = listener.call(
          this,
          new MessageEvent("message", { data: this.rewriter.fromHost(data) }),
        );
        // The frames that follow it (#3943), heard in order after it.
        for (const next of this.rewriter.followUp?.(data) ?? []) {
          listener.call(this, new MessageEvent("message", { data: next }));
        }
        return answer;
      };
      listen.call(this, type, rewritten, options);
    }
  }
  target.WebSocket = Held;
}

/** The init script a print adds: the page's WebSocket wrapped with `holdsRewriter`. */
export function holdsScript(): string {
  return `(${installHolds.toString()})(window, () => (${holdsRewriter.toString()})());`;
}

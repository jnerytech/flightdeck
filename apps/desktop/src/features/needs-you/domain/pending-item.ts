import type { PermissionUpdate, PlainInfo, RiskLevel } from "@flightdeck/protocol";

export interface PendingItem {
  hostId: string;
  hostName: string;
  sessionId: string;
  sessionName: string;
  /** Issue #1545: the project of the card that asks, so two cards of one title stay apart. */
  projectName?: string;
  requestId: string;
  toolName: string;
  createdAt: string;
  /** A request of a session opened outside Flightdeck (`sessionId` is its claudeSessionId). */
  external?: boolean;
  /** The tool input, long strings cut (phase 8: the tray shows a summary). */
  input?: Record<string, unknown>;
  /** The session's folder (phase 10: the queue's card makes paths relative to it). */
  cwd?: string | null;
  /** An open gate of a workflow run (`sessionId` is the card), answered with `gate.respond`. */
  gate?: GateRef;
  /** What the gate asks and shows, so it is approved in sight of it (issue #245). */
  gateText?: { message: string; output?: string };
  /** Phase 13: the risk the daemon judged for the request; an older daemon sends none. */
  risk?: RiskLevel;
  riskReason?: string;
  /** Issue #88: the request in plain words, for the surfaces outside the window; an older daemon sends none. */
  plain?: PlainInfo;
  /**
   * Issue #1751: a terminal session waits at a plan approval or a question. It has no request to
   * answer (`requestId` is made up): the person answers in the terminal, the app only opens it.
   */
  waiting?: "plan" | "question";
  /** Phase 17: the daemon asks for a secret to run an action or a free command. */
  vault?: true;
  /** Phase 19: the rule lets this request be approved for the rest of the session. */
  vaultOnce?: true;
  /** Phase 19: what a rule made from this request matches ("Criar regra a partir disto"). */
  vaultRule?: { secretId: string; match: Record<string, string> };
}

export interface GateRef {
  runId: string;
  stepId: string;
  attempt: number;
  cardId: string;
}

/** What goes with an answer to a request, besides allow or deny. */
export interface Answer {
  /** "Allow in this session" and "always in this project" (phase 7). */
  updatedPermissions?: PermissionUpdate[];
  /** Why it was denied (phase 10: the card's reason). */
  message?: string;
  /** The tool's input as the person changed it (the answers of AskUserQuestion). */
  updatedInput?: Record<string, unknown>;
  /**
   * The Approve was held its full time (#245): a high-risk request is approved only with it, so a
   * screen that forgets the risk cannot approve one with a click.
   */
  held?: boolean;
}

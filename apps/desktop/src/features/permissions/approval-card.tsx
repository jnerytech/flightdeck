import type {
  AutoApproval,
  PermissionResolution,
  PermissionUpdate,
  RiskLevel,
} from "@flightdeck/protocol";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { formatAgo } from "@/i18n/format";
import type { Key, T } from "@/i18n/index";
import { cn } from "@/lib/utils";
import { focusLost, useBusy } from "@/shared/hooks/index.ts";
import { AlwaysAllow } from "./always-allow.tsx";
import { AnswerButtons, CardTitle, PlanOrBody } from "./approval-body.tsx";
import { approvalView } from "./domain/approval.ts";
import { resolutionLine, savedAnswers } from "./domain/approval-lines.ts";
import {
  type AskPick,
  answeredInput,
  buildAnswers,
  parseQuestions,
} from "./domain/ask-question.ts";
import { QuestionForm } from "./question-form.tsx";

/** One open (or answered) permission request, from any kind of session. */
export interface ApprovalRequest {
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
  /** The session's folder: Bash shows it, file paths are made relative to it. */
  cwd: string | null;
  createdAt: string | null;
  suggestions?: PermissionUpdate[];
  /** Phase 13: how risky the daemon judged the request; an older daemon sends none. */
  risk?: RiskLevel;
  riskReason?: string;
}

/** How long the Aprovar of a high-risk request has to be held (phase 13): ApprovalActions holds it. */
export { HIGH_RISK_HOLD_MS } from "./approval-actions.tsx";

/** The risk seal: a word, a tone and, on a high one, why. */
const RISK_TONE: Record<RiskLevel, string> = {
  low: "border-border text-muted-foreground",
  medium: "border-status-needs-you/60 text-status-needs-you",
  high: "border-status-error text-status-error",
};

export function RiskSeal({
  risk,
  reason,
  t,
}: Readonly<{ risk: RiskLevel; reason?: string; t: T }>) {
  return (
    <span
      data-risk={risk}
      title={reason}
      className={cn("rounded-full border px-2 py-0.5 font-medium text-xs", RISK_TONE[risk])}
    >
      {t(`approval.risk.${risk}` as Key)}
    </span>
  );
}

/**
 * The approval card of every session (managed, terminal, card) and of the sidebar's queue: what
 * the tool will do, readable, with Aprovar and Negar together. With the card focused, A approves,
 * N denies (the reason opens) and Esc leaves it.
 */
export function ApprovalCard(
  props: Readonly<{
    request: ApprovalRequest;
    t: T;
    nowMs: number;
    /** The host announces `rules` (phase 7): "permitir nesta sessão" and "sempre neste projeto". */
    alwaysAllow?: boolean;
    resolution?: {
      decision: PermissionResolution;
      message?: string;
      auto?: AutoApproval;
      /** AskUserQuestion: the chosen answer of each question (the resolved event carries it). */
      answers?: Record<string, string>;
    };
    /** Test seam: the hold time of a high-risk approval (2 s when absent). */
    holdMs?: number;
    /** A promise keeps the card busy until the answer is in; anything else answers at once. */
    onRespond(
      decision: "allow" | "deny",
      message?: string,
      updatedPermissions?: PermissionUpdate[],
      /** The tool's input as the user changed it (the answers of AskUserQuestion). */
      updatedInput?: Record<string, unknown>,
      /** The Approve was held its full time: a high-risk request needs it (#245). */
      held?: true,
    ): unknown;
    /** More buttons next to Aprovar and Negar (the queue's "Abrir sessão"). */
    actions?: ReactNode;
    /** What is approved, when it is not a tool's input (a workflow gate's question, #245). */
    body?: ReactNode;
    /** Copies the session's folder (the whole path) when the user asks. */
    onCopyPath?(path: string): void;
  }>,
) {
  const { request, t, resolution } = props;
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("");
  /** An answer is on its way: the card is busy and takes no other. */
  const { busy: pending, run } = useBusy();
  const root = useRef<HTMLElement | null>(null);
  /** The focus was inside the card when the answer left: Approve is gone once it is answered (#1546). */
  const hadFocus = useRef(false);
  const respond = (...args: Parameters<typeof props.onRespond>) => {
    hadFocus.current = Boolean(root.current?.contains(document.activeElement));
    return run(() => props.onRespond(...args));
  };
  // The buttons that had the focus went with the answer, and the browser left it on the page body: it
  // goes to the next request waiting, or, with none, to this one, which says what was decided.
  const answered = Boolean(resolution);
  useEffect(() => {
    if (!answered || !hadFocus.current) return;
    hadFocus.current = false;
    if (!focusLost()) return;
    const waiting = document.querySelectorAll<HTMLElement>(
      '[data-slot="approval-card"][data-state="waiting"]',
    );
    // One in a hidden or inert panel (another session's tab) cannot take the focus.
    const next = Array.from(waiting).find(
      (card) =>
        card !== root.current &&
        !card.closest("[inert],[hidden],[aria-hidden=true]") &&
        (card.checkVisibility?.() ?? true),
    );
    (next ?? root.current)?.focus();
  }, [answered]);
  const reasonRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (denying) reasonRef.current?.focus();
  }, [denying]);
  const view = approvalView(request.toolName, request.input, request.cwd);
  const questions = request.toolName === "AskUserQuestion" ? parseQuestions(request.input) : null;
  const plan =
    request.toolName === "ExitPlanMode" && typeof request.input.plan === "string"
      ? request.input.plan
      : null;
  const [picks, setPicks] = useState<Record<string, AskPick>>({});
  const answers = questions ? buildAnswers(questions, picks) : null;
  const asks = questions !== null || plan !== null;
  // A plan is held like any request (#245); a question approves no action, so it never is.
  const high = request.risk === "high" && !questions;
  const age = request.createdAt ? formatAgo(props.nowMs - Date.parse(request.createdAt), t) : null;
  const deny = () => {
    const message = reason.trim();
    if (message) respond("deny", message);
    else respond("deny");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    // Keys typed in the reason (or any other field of the card) are text, not shortcuts.
    if (e.target !== e.currentTarget || resolution || pending) return;
    // Ctrl+A or Cmd+A is select-all, and a held key repeats: only a plain press answers (#244).
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const key = e.key.toLowerCase();
    // A high-risk request is approved by holding the button, never by a key.
    if (key === "a" && !high && !questions) respond("allow");
    else if (key === "n") setDenying(true);
    else if (e.key === "Escape") {
      // Handled here: left unmarked, the key reaches SplitView and closes the detail too (#2591).
      e.preventDefault();
      e.currentTarget.blur();
    }
  };

  if (questions && resolution) {
    const given = resolution.answers ?? answers ?? savedAnswers(request.input);
    const outcome = resolutionLine(resolution, t);
    // Nobody answered (denied, expired, cancelled): the outcome is said once, after the questions.
    const unanswered = questions.every((q) => given?.[q.question] === undefined);
    return (
      <details
        ref={(el) => {
          root.current = el;
        }}
        tabIndex={-1}
        data-answered
        data-state="answered"
        data-request-id={request.requestId}
        className="rounded-lg border border-border bg-card px-4 py-2 text-card-foreground text-sm"
      >
        <summary className="cursor-pointer">
          {unanswered
            ? `${questions.map((q) => q.header || q.question).join(" · ")}: ${outcome}`
            : questions
                .map((q) => `${q.header || q.question}: ${given?.[q.question] ?? outcome}`)
                .join(" · ")}
        </summary>
        <dl className="mt-2 flex flex-col gap-1">
          {questions.map((q) => (
            <div key={q.question}>
              <dt className="text-muted-foreground text-xs">{q.question}</dt>
              {!unanswered && <dd>{given?.[q.question] ?? outcome}</dd>}
            </div>
          ))}
          {unanswered && (
            <div>
              <dd>{outcome}</dd>
            </div>
          )}
        </dl>
      </details>
    );
  }

  return (
    <fieldset // NOSONAR: the card is the focus target of its A/N/Esc keys; a button inside would put them on the wrong element and change the focus order
      ref={(el) => {
        root.current = el;
      }}
      aria-label={t("approval.label", { tool: request.toolName })}
      data-slot="approval-card"
      data-state={resolution ? "answered" : "waiting"}
      data-request-id={request.requestId}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the card takes focus for its A/N/Esc keys
      tabIndex={0} // NOSONAR: same reason: the card itself takes the focus
      onKeyDown={onKeyDown}
      className={cn(
        "m-0 flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4 text-card-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring",
        resolution ? "border-border" : "border-status-needs-you/50",
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span>
          <CardTitle asks={Boolean(questions)} plan={plan !== null} tool={request.toolName} t={t} />
        </span>
        <span className="flex items-baseline gap-2">
          {request.risk && !asks && (
            <RiskSeal risk={request.risk} reason={request.riskReason} t={t} />
          )}
          {age && <span className="text-muted-foreground text-xs">{age}</span>}
        </span>
      </div>
      {high && request.riskReason && (
        <p className="text-sm text-status-error">{request.riskReason}</p>
      )}
      {questions ? (
        <QuestionForm
          questions={questions}
          picks={picks}
          t={t}
          disabled={Boolean(resolution) || pending}
          onChange={(question, pick) => setPicks((all) => ({ ...all, [question]: pick }))}
        />
      ) : (
        <PlanOrBody plan={plan} body={props.body} view={view} t={t} onCopyPath={props.onCopyPath} />
      )}
      {resolution ? (
        <p className="text-muted-foreground text-sm">{resolutionLine(resolution, t)}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <AnswerButtons
              t={t}
              pending={pending}
              high={high}
              plan={plan !== null}
              holdMs={props.holdMs}
              denying={denying}
              reason={reason}
              reasonRef={reasonRef}
              onReason={setReason}
              onDenying={setDenying}
              onDeny={deny}
              answers={answers}
              asks={questions !== null}
              onSendAnswers={() =>
                answers &&
                respond("allow", undefined, undefined, answeredInput(request.input, answers))
              }
              onApprove={(held) =>
                held ? respond("allow", undefined, undefined, undefined, true) : respond("allow")
              }
            />
            {props.actions}
          </div>
          {props.alwaysAllow && !high && !questions && plan === null && (
            <AlwaysAllow
              toolName={request.toolName}
              input={request.input}
              suggestions={request.suggestions}
              cwd={request.cwd ?? undefined}
              disabled={pending}
              onAllow={(updates) => respond("allow", undefined, updates)}
            />
          )}
          <p className="text-muted-foreground text-xs">
            {t(high ? "approval.keysHigh" : "approval.keys")}
          </p>
        </>
      )}
    </fieldset>
  );
}

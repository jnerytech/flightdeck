import type {
  AutoApproval,
  PermissionResolution,
  PermissionUpdate,
  RiskLevel,
} from "@flightdeck/protocol";
import { Copy } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBusy } from "@/hooks/use-busy";
import { formatAgo } from "@/i18n/format";
import type { Key, T } from "@/i18n/index";
import { type ApprovalView, approvalView, shortPath } from "@/lib/approval";
import { type AskPick, answeredInput, buildAnswers, parseQuestions } from "@/lib/ask-question";
import { cn } from "@/lib/utils";
import { AlwaysAllow } from "../../ui/AlwaysAllow.tsx";
import { Markdown } from "../../ui/Markdown.tsx";
import { HoldButton } from "./hold-button.tsx";
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
  risk?: RiskLevel | undefined;
  riskReason?: string | undefined;
}

/** How long the Aprovar of a high-risk request has to be held (phase 13). */
export const HIGH_RISK_HOLD_MS = 2000;

/** Diff lines shown before the card cuts the preview. */
const MAX_LINES = 40;

const LINE_TONE = {
  "+": "text-status-idle",
  "-": "text-status-error",
  " ": "text-muted-foreground",
} as const;

function Body({
  view,
  t,
  onCopyPath,
}: {
  view: ApprovalView;
  t: T;
  onCopyPath?: ((path: string) => void) | undefined;
}) {
  if (view.kind === "bash") {
    return (
      <div className="flex flex-col gap-2">
        <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
          <code>{view.command}</code>
        </pre>
        {view.description && <p className="text-sm">{view.description}</p>}
        {view.cwd && (
          <p className="flex items-center gap-1 text-muted-foreground text-xs">
            {t("approval.cwd")}:{" "}
            <span data-folder title={view.cwd} className="font-mono">
              {shortPath(view.cwd)}
            </span>
            {onCopyPath && (
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                aria-label={t("approval.copyFolder")}
                onClick={() => onCopyPath(view.cwd as string)}
              >
                <Copy />
              </Button>
            )}
          </p>
        )}
      </div>
    );
  }
  if (view.kind === "file") {
    const shown = view.lines.slice(0, MAX_LINES);
    return (
      <div className="flex flex-col gap-2">
        <p className="break-all font-mono text-sm">{view.path}</p>
        <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
          {shown.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: diff lines are positional and immutable
            <div key={i} className={LINE_TONE[line.op]}>{`${line.op} ${line.text}`}</div>
          ))}
          {view.lines.length > MAX_LINES && <div className="text-muted-foreground">…</div>}
        </pre>
      </div>
    );
  }
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
      {view.entries.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-muted-foreground">{key}</dt>
          <dd className="break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The risk seal: a word, a tone and, on a high one, why. */
const RISK_TONE: Record<RiskLevel, string> = {
  low: "border-border text-muted-foreground",
  medium: "border-status-needs-you/60 text-status-needs-you",
  high: "border-status-error text-status-error",
};

function RiskSeal({ risk, reason, t }: { risk: RiskLevel; reason?: string | undefined; t: T }) {
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

/** The answers a request already carries (the tool's input after it was answered), if any. */
function savedAnswers(input: Record<string, unknown>): Record<string, string> | null {
  const saved = input.answers;
  return saved && typeof saved === "object" ? (saved as Record<string, string>) : null;
}

/** "Aprovado automaticamente (regra): motivo": who decided, and why. */
function autoLine(auto: AutoApproval, t: T): string {
  const by =
    auto.by === "ai"
      ? auto.model
        ? t("approval.autoBy.aiModel", { model: auto.model })
        : t("approval.autoBy.ai")
      : t("approval.autoBy.rule");
  return t("approval.autoApproved", { by, reason: auto.reason });
}

/** The denial form: whether it is open, the reason typed, and the answer it sends (focus goes to the reason). */
function useDenyForm(respond: (decision: "deny", message?: string) => unknown) {
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("");
  const reasonRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (denying) reasonRef.current?.focus();
  }, [denying]);
  const deny = () => {
    const message = reason.trim();
    if (message) respond("deny", message);
    else respond("deny");
  };
  return { denying, setDenying, reason, setReason, reasonRef, deny };
}

/**
 * What a key typed on the card means: A approves, N denies (the reason opens), Esc leaves. Keys
 * typed in the reason (or any other field of the card) are text, not shortcuts; a card already
 * answered or busy takes none; a high-risk request is approved by holding the button, never by a key.
 */
function keyAction(
  e: KeyboardEvent<HTMLElement>,
  card: { settled: boolean; high: boolean; questions: boolean },
): "allow" | "deny" | "leave" | null {
  if (e.target !== e.currentTarget || card.settled) return null;
  const key = e.key.toLowerCase();
  if (key === "a" && !card.high && !card.questions) return "allow";
  if (key === "n") return "deny";
  return e.key === "Escape" ? "leave" : null;
}

/** Does what the key asked for (nothing for a key that means nothing). */
function runKeyAction(
  action: ReturnType<typeof keyAction>,
  on: { allow(): void; deny(): void; leave(): void },
): void {
  if (action) on[action]();
}

/** The questions an AskUserQuestion request carries; null for any other request. */
function questionsOf(request: ApprovalRequest) {
  return request.toolName === "AskUserQuestion" ? parseQuestions(request.input) : null;
}

/** The plan an ExitPlanMode request carries; null for any other request. */
function planOf(request: ApprovalRequest): string | null {
  const plan = request.input.plan;
  return request.toolName === "ExitPlanMode" && typeof plan === "string" ? plan : null;
}

/** How long ago the request was made, in words; null when it carries no time. */
function ageOf(request: ApprovalRequest, nowMs: number, t: T): string | null {
  return request.createdAt ? formatAgo(nowMs - Date.parse(request.createdAt), t) : null;
}

/** The plan as Markdown, or what the tool will do. */
function PlanOrBody(props: {
  plan: string | null;
  view: ReturnType<typeof approvalView>;
  t: T;
  onCopyPath: ((path: string) => void) | undefined;
}) {
  if (props.plan !== null) return <Markdown text={props.plan} />;
  return <Body view={props.view} t={props.t} onCopyPath={props.onCopyPath} />;
}

/** The top of the card: what asks, how risky it is, how long ago, and why a high risk is high. */
function CardHeader(props: {
  request: ApprovalRequest;
  asking: boolean;
  planning: boolean;
  high: boolean;
  age: string | null;
  t: T;
}) {
  const { request, t, age } = props;
  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <CardTitle asking={props.asking} planning={props.planning} tool={request.toolName} t={t} />
        <span className="flex items-baseline gap-2">
          {request.risk && !props.asking && !props.planning && (
            <RiskSeal risk={request.risk} reason={request.riskReason} t={t} />
          )}
          {age && <span className="text-muted-foreground text-xs">{age}</span>}
        </span>
      </div>
      {props.high && request.riskReason && (
        <p className="text-sm text-status-error">{request.riskReason}</p>
      )}
    </>
  );
}

/** Under the buttons: "always allow" when offered, and the keys hint. */
function CardFooter(props: {
  show: boolean;
  high: boolean;
  request: ApprovalRequest;
  pending: boolean;
  t: T;
  onAllow(updates: PermissionUpdate[]): void;
}) {
  const { request, t } = props;
  return (
    <>
      {props.show && (
        <AlwaysAllow
          toolName={request.toolName}
          input={request.input}
          suggestions={request.suggestions}
          disabled={props.pending}
          onAllow={props.onAllow}
        />
      )}
      <p className="text-muted-foreground text-xs">
        {t(props.high ? "approval.keysHigh" : "approval.keys")}
      </p>
    </>
  );
}

/** The row of buttons: the denial form, or approve and deny, then the caller's extra buttons. */
function ButtonRow(props: {
  denying: boolean;
  kind: "answers" | "hold" | "plain";
  planning: boolean;
  pending: boolean;
  answerable: boolean;
  holdMs: number;
  deny: {
    reason: string;
    inputRef: React.RefObject<HTMLInputElement | null>;
    onReason(value: string): void;
    onDeny(): void;
  };
  t: T;
  onApprove(): void;
  onSend(): void;
  onStartDeny(): void;
  onCancelDeny(): void;
  children?: ReactNode;
}) {
  const { t, pending } = props;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {props.denying ? (
        <DenyReason
          inputRef={props.deny.inputRef}
          reason={props.deny.reason}
          pending={pending}
          t={t}
          onReason={props.deny.onReason}
          onDeny={props.deny.onDeny}
          onCancel={props.onCancelDeny}
        />
      ) : (
        <>
          <ApproveButton
            kind={props.kind}
            planning={props.planning}
            pending={pending}
            answerable={props.answerable}
            holdMs={props.holdMs}
            t={t}
            onApprove={props.onApprove}
            onSend={props.onSend}
          />
          <Button variant="outline" disabled={pending} onClick={props.onStartDeny}>
            {t(props.planning ? "approval.plan.keep" : "approval.deny")}
          </Button>
        </>
      )}
      {props.children}
    </div>
  );
}

/** The reason a denial can carry, with the button that denies and the one that backs out. */
function DenyReason(props: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  reason: string;
  pending: boolean;
  t: T;
  onReason(value: string): void;
  onDeny(): void;
  onCancel(): void;
}) {
  const { t } = props;
  return (
    <>
      <Input
        ref={props.inputRef}
        aria-label={t("approval.reason")}
        placeholder={t("approval.reason")}
        value={props.reason}
        onChange={(e) => props.onReason(e.target.value)}
        className="w-56"
      />
      <ActionButton variant="destructive" pending={props.pending} onClick={props.onDeny}>
        {t("approval.deny")}
      </ActionButton>
      <Button variant="ghost" disabled={props.pending} onClick={props.onCancel}>
        {t("approval.cancel")}
      </Button>
    </>
  );
}

/** The button that approves: send the answers of a question, hold for a high risk, or a plain approval. */
function ApproveButton(props: {
  kind: "answers" | "hold" | "plain";
  planning: boolean;
  pending: boolean;
  answerable: boolean;
  holdMs: number;
  t: T;
  onApprove(): void;
  onSend(): void;
}) {
  const { t } = props;
  if (props.kind === "answers") {
    return (
      <ActionButton pending={props.pending} disabled={!props.answerable} onClick={props.onSend}>
        {t("approval.question.send")}
      </ActionButton>
    );
  }
  if (props.kind === "hold") {
    return (
      <HoldButton
        label={t("approval.hold")}
        hint={t("approval.holdHint")}
        holdMs={props.holdMs}
        disabled={props.pending}
        onHeld={props.onApprove}
      />
    );
  }
  return (
    <ActionButton pending={props.pending} onClick={props.onApprove}>
      {t(props.planning ? "approval.plan.approve" : "approval.approve")}
    </ActionButton>
  );
}

/** A question card that was answered: one line with the answers, and the full list when opened. */
function AnsweredQuestions(props: {
  questions: NonNullable<ReturnType<typeof parseQuestions>>;
  resolution: NonNullable<Parameters<typeof ApprovalCard>[0]["resolution"]>;
  answers: Record<string, string> | null;
  request: ApprovalRequest;
  t: T;
}) {
  const { questions, resolution, answers, request, t } = props;
  const given = resolution.answers ?? answers ?? savedAnswers(request.input);
  const outcome = t(`approval.resolved.${resolution.decision}` as Key);
  return (
    <details
      data-answered
      data-request-id={request.requestId}
      className="rounded-lg border border-border bg-card px-4 py-2 text-card-foreground text-sm"
    >
      <summary className="cursor-pointer">
        {questions
          .map((q) => `${q.header || q.question}: ${given?.[q.question] ?? outcome}`)
          .join(" · ")}
      </summary>
      <dl className="mt-2 flex flex-col gap-1">
        {questions.map((q) => (
          <div key={q.question}>
            <dt className="text-muted-foreground text-xs">{q.question}</dt>
            <dd>{given?.[q.question] ?? outcome}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/** The title of the card: a question, a plan, or the tool that asks. */
function CardTitle(props: { asking: boolean; planning: boolean; tool: string; t: T }) {
  const { t } = props;
  if (props.asking)
    return (
      <span>
        <strong>{t("approval.askTitle")}</strong>
      </span>
    );
  if (props.planning)
    return (
      <span>
        <strong>{t("approval.planTitle")}</strong>
      </span>
    );
  return (
    <span>
      {t("approval.title")} <strong>{props.tool}</strong>
    </span>
  );
}

/** What the card says once it was answered: the reason of a denial, the auto-approval or the decision. */
function resolutionText(
  resolution: NonNullable<Parameters<typeof ApprovalCard>[0]["resolution"]>,
  t: T,
): string {
  if (resolution.decision === "deny" && resolution.message) {
    return t("approval.deniedWith", { message: resolution.message });
  }
  if (resolution.auto) return autoLine(resolution.auto, t);
  return t(`approval.resolved.${resolution.decision}` as Key);
}

/**
 * The approval card of every session (managed, terminal, card) and of the sidebar's queue: what
 * the tool will do, readable, with Aprovar and Negar together. With the card focused, A approves,
 * N denies (the reason opens) and Esc leaves it.
 */
export function ApprovalCard(props: {
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
  ): unknown;
  /** More buttons next to Aprovar and Negar (the queue's "Abrir sessão"). */
  actions?: ReactNode;
  /** Copies the session's folder (the whole path) when the user asks. */
  onCopyPath?(path: string): void;
}) {
  const { request, t, resolution } = props;
  /** An answer is on its way: the card is busy and takes no other. */
  const { busy: pending, run } = useBusy();
  const respond = (...args: Parameters<typeof props.onRespond>) =>
    run(() => props.onRespond(...args));
  const { denying, setDenying, reason, setReason, reasonRef, deny } = useDenyForm(respond);
  const view = approvalView(request.toolName, request.input, request.cwd);
  const questions = questionsOf(request);
  const plan = planOf(request);
  const [picks, setPicks] = useState<Record<string, AskPick>>({});
  const answers = questions ? buildAnswers(questions, picks) : null;
  const asks = questions !== null || plan !== null;
  const high = request.risk === "high" && !asks;
  const age = ageOf(request, props.nowMs, t);
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const action = keyAction(e, {
      settled: Boolean(resolution) || pending,
      high,
      questions: Boolean(questions),
    });
    runKeyAction(action, {
      allow: () => respond("allow"),
      deny: () => setDenying(true),
      leave: () => e.currentTarget.blur(),
    });
  };

  if (questions && resolution) {
    return (
      <AnsweredQuestions
        questions={questions}
        resolution={resolution}
        answers={answers}
        request={request}
        t={t}
      />
    );
  }

  return (
    <fieldset
      aria-label={t("approval.label", { tool: request.toolName })}
      data-request-id={request.requestId}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the card takes focus for its A/N/Esc keys
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={cn(
        "m-0 flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4 text-card-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring",
        resolution ? "border-border" : "border-status-needs-you/50",
      )}
    >
      <CardHeader
        request={request}
        asking={questions !== null}
        planning={plan !== null}
        high={high}
        age={age}
        t={t}
      />
      {questions ? (
        <QuestionForm
          questions={questions}
          picks={picks}
          t={t}
          disabled={Boolean(resolution) || pending}
          onChange={(question, pick) => setPicks((all) => ({ ...all, [question]: pick }))}
        />
      ) : (
        <PlanOrBody plan={plan} view={view} t={t} onCopyPath={props.onCopyPath} />
      )}
      {resolution ? (
        <p className="text-muted-foreground text-sm">{resolutionText(resolution, t)}</p>
      ) : (
        <>
          <ButtonRow
            denying={denying}
            kind={questions ? "answers" : high ? "hold" : "plain"}
            planning={plan !== null}
            pending={pending}
            answerable={Boolean(answers)}
            holdMs={props.holdMs ?? HIGH_RISK_HOLD_MS}
            deny={{ reason, inputRef: reasonRef, onReason: setReason, onDeny: deny }}
            t={t}
            onApprove={() => respond("allow")}
            onSend={() =>
              answers &&
              respond("allow", undefined, undefined, answeredInput(request.input, answers))
            }
            onStartDeny={() => setDenying(true)}
            onCancelDeny={() => setDenying(false)}
          >
            {props.actions}
          </ButtonRow>
          <CardFooter
            show={Boolean(props.alwaysAllow) && !high && !questions && plan === null}
            high={high}
            request={request}
            pending={pending}
            t={t}
            onAllow={(updates) => respond("allow", undefined, updates)}
          />
        </>
      )}
    </fieldset>
  );
}

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
import { cn } from "@/lib/utils";
import { AlwaysAllow } from "../../ui/AlwaysAllow.tsx";
import { HoldButton } from "./hold-button.tsx";

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
  resolution?: { decision: PermissionResolution; message?: string; auto?: AutoApproval };
  /** Test seam: the hold time of a high-risk approval (2 s when absent). */
  holdMs?: number;
  /** A promise keeps the card busy until the answer is in; anything else answers at once. */
  onRespond(
    decision: "allow" | "deny",
    message?: string,
    updatedPermissions?: PermissionUpdate[],
  ): unknown;
  /** More buttons next to Aprovar and Negar (the queue's "Abrir sessão"). */
  actions?: ReactNode;
  /** Copies the session's folder (the whole path) when the user asks. */
  onCopyPath?(path: string): void;
}) {
  const { request, t, resolution } = props;
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("");
  /** An answer is on its way: the card is busy and takes no other. */
  const { busy: pending, run } = useBusy();
  const respond = (...args: Parameters<typeof props.onRespond>) =>
    run(() => props.onRespond(...args));
  const reasonRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (denying) reasonRef.current?.focus();
  }, [denying]);
  const view = approvalView(request.toolName, request.input, request.cwd);
  const high = request.risk === "high";
  const age = request.createdAt ? formatAgo(props.nowMs - Date.parse(request.createdAt), t) : null;
  const deny = () => {
    const message = reason.trim();
    if (message) respond("deny", message);
    else respond("deny");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    // Keys typed in the reason (or any other field of the card) are text, not shortcuts.
    if (e.target !== e.currentTarget || resolution || pending) return;
    const key = e.key.toLowerCase();
    // A high-risk request is approved by holding the button, never by a key.
    if (key === "a" && !high) respond("allow");
    else if (key === "n") setDenying(true);
    else if (e.key === "Escape") e.currentTarget.blur();
  };

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
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span>
          {t("approval.title")} <strong>{request.toolName}</strong>
        </span>
        <span className="flex items-baseline gap-2">
          {request.risk && <RiskSeal risk={request.risk} reason={request.riskReason} t={t} />}
          {age && <span className="text-muted-foreground text-xs">{age}</span>}
        </span>
      </div>
      {high && request.riskReason && (
        <p className="text-sm text-status-error">{request.riskReason}</p>
      )}
      <Body view={view} t={t} onCopyPath={props.onCopyPath} />
      {resolution ? (
        <p className="text-muted-foreground text-sm">
          {resolution.decision === "deny" && resolution.message
            ? t("approval.deniedWith", { message: resolution.message })
            : resolution.auto
              ? autoLine(resolution.auto, t)
              : t(`approval.resolved.${resolution.decision}` as Key)}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {denying ? (
              <>
                <Input
                  ref={reasonRef}
                  aria-label={t("approval.reason")}
                  placeholder={t("approval.reason")}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-56"
                />
                <ActionButton variant="destructive" pending={pending} onClick={deny}>
                  {t("approval.deny")}
                </ActionButton>
                <Button variant="ghost" disabled={pending} onClick={() => setDenying(false)}>
                  {t("approval.cancel")}
                </Button>
              </>
            ) : (
              <>
                {high ? (
                  <HoldButton
                    label={t("approval.hold")}
                    hint={t("approval.holdHint")}
                    holdMs={props.holdMs ?? HIGH_RISK_HOLD_MS}
                    disabled={pending}
                    onHeld={() => respond("allow")}
                  />
                ) : (
                  <ActionButton pending={pending} onClick={() => respond("allow")}>
                    {t("approval.approve")}
                  </ActionButton>
                )}
                <Button variant="outline" disabled={pending} onClick={() => setDenying(true)}>
                  {t("approval.deny")}
                </Button>
              </>
            )}
            {props.actions}
          </div>
          {props.alwaysAllow && !high && (
            <AlwaysAllow
              toolName={request.toolName}
              input={request.input}
              suggestions={request.suggestions}
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

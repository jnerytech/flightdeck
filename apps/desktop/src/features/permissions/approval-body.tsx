import { Copy } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { T } from "@/i18n/index";
import { ActionButton } from "@/shared/feedback/index.ts";
import { uniqueKeys } from "@/shared/lib/index.ts";
import { Markdown } from "@/shared/markdown/index.ts";
import { ApprovalActions } from "./approval-actions.tsx";
import { type ApprovalView, type approvalView, shortPath } from "./domain/approval.ts";

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
}: Readonly<{
  view: ApprovalView;
  t: T;
  onCopyPath?: (path: string) => void;
}>) {
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
            <span data-folder title={view.cwd} className="min-w-0 break-all font-mono">
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
    const ids = uniqueKeys(shown.map((line) => `${line.op} ${line.text}`));
    const keyed = shown.map((line, at) => ({ id: ids[at], line }));
    return (
      <div className="flex flex-col gap-2">
        <p className="break-all font-mono text-sm">{view.path}</p>
        <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
          {keyed.map(({ id, line }) => (
            <div key={id} className={LINE_TONE[line.op]}>{`${line.op} ${line.text}`}</div>
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

/** The card's heading: a question, a plan, or the tool that asks. */
export function CardTitle(props: Readonly<{ asks: boolean; plan: boolean; tool: string; t: T }>) {
  const { asks, plan, tool, t } = props;
  if (asks) return <strong>{t("approval.askTitle")}</strong>;
  if (plan) return <strong>{t("approval.planTitle")}</strong>;
  return (
    <>
      {t("approval.title")} <strong>{tool}</strong>
    </>
  );
}

/** The plan as Markdown, or what the tool will do (a given body, else the readable view). */
export function PlanOrBody(
  props: Readonly<{
    plan: string | null;
    body: ReactNode | undefined;
    view: ReturnType<typeof approvalView>;
    t: T;
    onCopyPath: ((path: string) => void) | undefined;
  }>,
) {
  if (props.plan !== null) return <Markdown text={props.plan} />;
  return props.body ?? <Body view={props.view} t={props.t} onCopyPath={props.onCopyPath} />;
}

/**
 * The buttons that answer a request: the reason form once Deny was pressed, Send for a question,
 * else Approve (held when high risk) and Deny, the same as every screen (issue #182).
 */
export function AnswerButtons(
  props: Readonly<{
    t: T;
    pending: boolean;
    high: boolean;
    plan: boolean;
    holdMs: number | undefined;
    denying: boolean;
    reason: string;
    reasonRef: RefObject<HTMLInputElement | null>;
    onReason(reason: string): void;
    onDenying(denying: boolean): void;
    onDeny(): void;
    /** The answers of a question, once all are given. */
    answers: Record<string, string> | null;
    asks: boolean;
    onSendAnswers(): void;
    onApprove(held: boolean): unknown;
  }>,
) {
  const { t, pending } = props;
  if (props.denying) {
    return (
      <>
        <Input
          ref={props.reasonRef}
          aria-label={t("approval.reason")}
          placeholder={t("approval.reason")}
          value={props.reason}
          onChange={(e) => props.onReason(e.target.value)}
          className="w-56"
        />
        <ActionButton variant="destructive" pending={pending} onClick={props.onDeny}>
          {t("approval.deny")}
        </ActionButton>
        <Button variant="ghost" disabled={pending} onClick={() => props.onDenying(false)}>
          {t("approval.cancel")}
        </Button>
      </>
    );
  }
  if (props.asks) {
    return (
      <>
        <ActionButton pending={pending} disabled={!props.answers} onClick={props.onSendAnswers}>
          {t("approval.question.send")}
        </ActionButton>
        <Button variant="outline" disabled={pending} onClick={() => props.onDenying(true)}>
          {t("approval.deny")}
        </Button>
      </>
    );
  }
  return (
    <ApprovalActions
      risk={props.high ? "high" : undefined}
      pending={pending}
      {...(props.holdMs !== undefined ? { holdMs: props.holdMs } : {})}
      {...(props.plan
        ? { labels: { approve: t("approval.plan.approve"), deny: t("approval.plan.keep") } }
        : {})}
      onApprove={props.onApprove}
      onDeny={() => props.onDenying(true)}
    />
  );
}

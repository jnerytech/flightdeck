import type { AutoApproval, PermissionResolution } from "@flightdeck/protocol";
import type { T } from "@/i18n/index";
import { resolutionLine, savedAnswers } from "./domain/approval-lines.ts";
import type { AskQuestion } from "./domain/ask-question.ts";

/** What the card says once an AskUserQuestion is answered, denied, expired or cancelled. */
export function AnsweredQuestions({
  questions,
  resolution,
  answers,
  input,
  requestId,
  rootRef,
  t,
}: Readonly<{
  questions: AskQuestion[];
  resolution: {
    decision: PermissionResolution;
    message?: string;
    auto?: AutoApproval;
    answers?: Record<string, string>;
  };
  /** What the person picked in this card, when the resolved event carries no answers. */
  answers: Record<string, string> | null;
  input: Record<string, unknown>;
  requestId: string;
  rootRef(el: HTMLElement | null): void;
  t: T;
}>) {
  const given = resolution.answers ?? answers ?? savedAnswers(input);
  const outcome = resolutionLine(resolution, t);
  // Nobody answered (denied, expired, cancelled): the outcome is said once, after the questions.
  const unanswered = questions.every((q) => given?.[q.question] === undefined);
  return (
    <details
      ref={rootRef}
      tabIndex={-1}
      data-answered
      data-state="answered"
      data-request-id={requestId}
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
        {unanswered ? (
          // One outcome for every question: several terms share one description.
          <div>
            {questions.map((q) => (
              <dt key={q.question} className="text-muted-foreground text-xs">
                {q.question}
              </dt>
            ))}
            <dd>{outcome}</dd>
          </div>
        ) : (
          questions.map((q) => (
            <div key={q.question}>
              <dt className="text-muted-foreground text-xs">{q.question}</dt>
              <dd>{given?.[q.question] ?? outcome}</dd>
            </div>
          ))
        )}
      </dl>
    </details>
  );
}

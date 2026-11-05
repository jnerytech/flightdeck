import { Input } from "@/components/ui/input";
import type { T } from "@/i18n/index";
import type { AskPick, AskQuestion } from "@/lib/ask-question";
import { Inline, Stack } from "../layout/stack.tsx";

/** Claude's questions (AskUserQuestion): each with its header, options and an "Other" text. */
/** The labels picked after one is toggled: several can be on in a multi-select, else only that one. */
function nextLabels(multiSelect: boolean, labels: string[], label: string, on: boolean): string[] {
  if (!multiSelect) return [label];
  return on ? [...labels, label] : labels.filter((l) => l !== label);
}

export function QuestionForm(
  props: Readonly<{
    questions: AskQuestion[];
    picks: Record<string, AskPick>;
    t: T;
    disabled?: boolean;
    onChange(question: string, pick: AskPick): void;
  }>,
) {
  const { questions, picks, t } = props;
  return (
    <Stack gap={4}>
      {questions.map((q, index) => {
        const pick = picks[q.question] ?? { labels: [], other: "" };
        const toggle = (label: string, on: boolean) =>
          props.onChange(q.question, {
            ...pick,
            labels: nextLabels(q.multiSelect, pick.labels, label, on),
          });
        return (
          <Stack key={q.question} gap={2}>
            {q.header && (
              <span className="font-medium text-muted-foreground text-xs uppercase">
                {q.header}
              </span>
            )}
            <p className="font-medium text-sm">{q.question}</p>
            {q.options.map((option) => (
              <label key={option.label} className="cursor-pointer text-sm">
                <Inline gap={2}>
                  <input
                    type={q.multiSelect ? "checkbox" : "radio"}
                    name={`ask-${index}`}
                    disabled={props.disabled}
                    checked={pick.labels.includes(option.label)}
                    onChange={(e) => toggle(option.label, e.target.checked)}
                  />
                  <strong>{option.label}</strong>
                </Inline>
                {option.description && (
                  <span className="block text-muted-foreground text-xs">{option.description}</span>
                )}
              </label>
            ))}
            <Input
              aria-label={`${t("approval.question.other")}: ${q.question}`}
              placeholder={t("approval.question.other")}
              disabled={props.disabled}
              value={pick.other}
              onChange={(e) => props.onChange(q.question, { ...pick, other: e.target.value })}
            />
          </Stack>
        );
      })}
    </Stack>
  );
}

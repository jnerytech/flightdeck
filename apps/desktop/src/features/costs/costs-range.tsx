import { useEffect, useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";
import { InlineNotice } from "@/shared/feedback/index.ts";
import { type RangeProblem, rangeProblem } from "./domain/costs.ts";

type Range = { from: string; to: string };

/**
 * The two dates of a custom range. The inputs show what the person typed; the screen is asked for a
 * range only when it is a real one, so a cleared or reversed date keeps the last good range and says why.
 */
export function RangeInputs(props: Readonly<{ range: Range; onRange(range: Range): void }>) {
  const t = useT();
  const noteId = useId();
  const [draft, setDraft] = useState(props.range);
  const { from, to } = props.range;
  // A range that came from outside (a valid change) is what the inputs show again.
  useEffect(() => setDraft({ from, to }), [from, to]);
  const problem: RangeProblem | null = rangeProblem(draft);
  const change = (next: Range) => {
    setDraft(next);
    if (rangeProblem(next) === null) props.onRange(next);
  };
  const flag = (day: string) =>
    problem === "reversed" || (problem === "empty" && day === "")
      ? ({ "aria-invalid": true, "aria-describedby": noteId } as const)
      : {};
  return (
    <>
      <Input
        type="date"
        aria-label={t("costsUi.from")}
        className="h-8 w-36 text-xs"
        value={draft.from}
        onChange={(e) => change({ ...draft, from: e.target.value })}
        {...flag(draft.from)}
      />
      <Input
        type="date"
        aria-label={t("costsUi.to")}
        className="h-8 w-36 text-xs"
        value={draft.to}
        onChange={(e) => change({ ...draft, to: e.target.value })}
        {...flag(draft.to)}
      />
      {problem && (
        <InlineNotice id={noteId}>
          {t(problem === "empty" ? "costsUi.rangeEmpty" : "costsUi.rangeReversed")}
        </InlineNotice>
      )}
    </>
  );
}

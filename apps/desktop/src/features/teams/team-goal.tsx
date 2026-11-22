import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { T } from "@/i18n/index";
import { Stack } from "@/shared/layout/index.ts";

/**
 * #4023: what the team is for, on top of its card under its own name. A long word (a URL) breaks
 * inside the card, and a long brief is clamped to three lines with a control that shows all of it,
 * so it never pushes the members out of sight. The control shows only when the text is taller
 * than the clamped box, which the browser measures; a goal that fits has none.
 */
export function TeamGoal(props: Readonly<{ t: T; goal: string }>) {
  const { t, goal } = props;
  const title = useId();
  const textId = useId();
  const text = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  // Measured while clamped: an open text has no limit to overflow, and the control stays for it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new goal is measured again
  useEffect(() => {
    const el = text.current;
    if (!el || expanded) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [expanded, goal]);
  return (
    <section aria-labelledby={title} className="min-w-0">
      <Stack gap={1}>
        <strong id={title}>{t("teamsUi.goal")}</strong>
        <p
          ref={text}
          id={textId}
          data-slot="team-goal-text"
          className={`text-muted-foreground whitespace-pre-wrap [overflow-wrap:anywhere]${expanded ? "" : " line-clamp-3"}`}
        >
          {goal}
        </p>
        {(overflows || expanded) && (
          <Button
            variant="link"
            size="sm"
            className="self-start"
            aria-expanded={expanded}
            aria-controls={textId}
            onClick={() => setExpanded((now) => !now)}
          >
            {t(expanded ? "teamsUi.goalLess" : "teamsUi.goalMore")}
          </Button>
        )}
      </Stack>
    </section>
  );
}

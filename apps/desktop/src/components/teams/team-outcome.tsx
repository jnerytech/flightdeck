import { useId } from "react";
import { Inline, Stack } from "@/components/layout/stack";
import { Badge } from "@/components/ui/badge";
import type { T } from "@/i18n/index";

/**
 * #1220: the coordinator's last report, the team's outcome, on top of its card. What a session
 * wrote is shown as plain text: React writes it as text, never as markup. A long word (a URL, a
 * hash) breaks inside the card, and a long report scrolls in a box the keyboard can reach.
 */
export function TeamOutcome(props: Readonly<{ t: T; outcome: { text: string; done: boolean } }>) {
  const { t, outcome } = props;
  const title = useId();
  return (
    <section
      aria-labelledby={title}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a box that scrolls must take the keyboard
      tabIndex={0}
      className="max-h-48 min-w-0 overflow-y-auto rounded-md border p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Stack gap={1}>
        <Inline gap={2}>
          <strong id={title}>{t("teamsUi.outcome")}</strong>
          <Badge variant="outline">
            {t(outcome.done ? "teamsUi.outcomeDone" : "teamsUi.outcomeProgress")}
          </Badge>
        </Inline>
        <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{outcome.text}</p>
      </Stack>
    </section>
  );
}

import { Inline, Stack } from "@/components/layout/stack";
import { Badge } from "@/components/ui/badge";
import type { T } from "@/i18n/index";

/**
 * #1220: the coordinator's last report, the team's outcome, on top of its card. What a session
 * wrote is shown as plain text: React writes it as text, never as markup.
 */
export function TeamOutcome(props: Readonly<{ t: T; outcome: { text: string; done: boolean } }>) {
  const { t, outcome } = props;
  return (
    <section aria-label={t("teamsUi.outcome")} className="rounded-md border p-2">
      <Stack gap={1}>
        <Inline gap={2}>
          <strong>{t("teamsUi.outcome")}</strong>
          <Badge variant="outline">
            {t(outcome.done ? "teamsUi.outcomeDone" : "teamsUi.outcomeProgress")}
          </Badge>
        </Inline>
        <p className="whitespace-pre-wrap">{outcome.text}</p>
      </Stack>
    </section>
  );
}

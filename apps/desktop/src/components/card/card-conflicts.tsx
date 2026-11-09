import type { Card } from "@flightdeck/protocol";
import { useId } from "react";
import { Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";

/**
 * The cards that change the same files as this one, and the files they share (#1405). Each title
 * opens its card (#1485); the heading describes it, so a screen reader hears which list it is in.
 */
export function CardConflicts(props: Readonly<{ card: Card; onOpenCard(cardId: string): void }>) {
  const t = useT();
  const headingId = useId();
  const others = props.card.mayConflict ?? [];
  if (others.length === 0) return null;
  return (
    <section aria-label={t("conflictRadar.title")}>
      <Stack gap={2}>
        <h3 id={headingId} className="font-medium text-sm">
          {t("conflictRadar.title")}
        </h3>
        <p className="text-muted-foreground text-sm">{t("conflictRadar.intro")}</p>
        <Stack as="ul" gap={2}>
          {others.map((other) => (
            <li key={other.cardId}>
              <Stack gap={1}>
                <Button
                  variant="link"
                  className="h-auto min-h-6 justify-start whitespace-normal p-0 text-left font-medium text-sm"
                  aria-describedby={headingId}
                  onClick={() => props.onOpenCard(other.cardId)}
                >
                  {other.title}
                </Button>
                <ul className="list-none text-muted-foreground text-xs">
                  {other.files.map((file) => (
                    <li key={file} className="break-all font-mono">
                      {file}
                    </li>
                  ))}
                </ul>
              </Stack>
            </li>
          ))}
        </Stack>
      </Stack>
    </section>
  );
}

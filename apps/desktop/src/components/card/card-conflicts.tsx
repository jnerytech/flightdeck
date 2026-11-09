import type { Card } from "@flightdeck/protocol";
import { Stack } from "@/components/layout/stack";
import { useT } from "@/i18n/context";

/** The cards that change the same files as this one, and the files they share (#1405). */
export function CardConflicts(props: Readonly<{ card: Card }>) {
  const t = useT();
  const others = props.card.mayConflict ?? [];
  if (others.length === 0) return null;
  return (
    <section aria-label={t("conflictRadar.title")}>
      <Stack gap={2}>
        <h3 className="font-medium text-sm">{t("conflictRadar.title")}</h3>
        <p className="text-muted-foreground text-sm">{t("conflictRadar.intro")}</p>
        <ul className="list-none">
          {others.map((other) => (
            <li key={other.cardId}>
              <Stack gap={1}>
                <span className="font-medium text-sm">{other.title}</span>
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
        </ul>
      </Stack>
    </section>
  );
}

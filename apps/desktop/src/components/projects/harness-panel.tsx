import type { ProjectLoad } from "@flightdeck/protocol";
import { useEffect, useState } from "react";
import { Panel } from "@/components/layout/panel";
import { Stack } from "@/components/layout/stack";
import type { AppStore } from "@/lib/app-store";
import { type HarnessItem, harnessParts } from "@/lib/harness";

type T = AppStore["i18n"]["t"];

/** What shows a part: its names, the kinds of its hooks, or how many allow rules it has. */
function detail(item: HarnessItem, t: T): string {
  if (item.part === "hooks")
    return item.detail.map((kind) => t(`projectPage.harness.kinds.${kind}` as never)).join(", ");
  if (item.part === "permissions")
    return item.detail.map((n) => t("projectPage.harness.rules", { n })).join("");
  return item.detail.join(", ");
}

/**
 * Issue #75, slice S1: the project's Claude Code setup as a checklist, read from the listing the
 * trust panel already asks for (#196). Read-only: it says what is there and what is missing.
 */
export function HarnessPanel(props: Readonly<{ store: AppStore; hostId: string; path: string }>) {
  const { store, hostId, path } = props;
  const { t } = store.i18n;
  const [load, setLoad] = useState<ProjectLoad | null>(null);

  useEffect(() => {
    let live = true;
    void store.hostCommand(hostId, "project.trust.inspect", { path }).then((read) => {
      if (live) setLoad(read ?? null);
    });
    return () => {
      live = false;
    };
  }, [store, hostId, path]);

  // No listing (an old host, or one the connection may not ask): no card.
  if (!load) return null;
  const items = harnessParts(load);
  const found = items.filter((item) => item.found).length;
  return (
    <Panel title={t("projectPage.harness.title")} label={t("projectPage.harness.title")}>
      <p className="text-muted-foreground text-xs">{t("projectPage.harness.hint")}</p>
      <p className="font-medium text-sm">
        {t("projectPage.harness.summary", { n: found, total: items.length })}
      </p>
      <Stack as="ul" gap={1} className="text-sm">
        {items.map((item) => {
          const name = t(`projectPage.harness.parts.${item.part}` as never);
          const shows = detail(item, t);
          return (
            <li key={item.part} aria-label={name}>
              <span className="font-medium">{name}</span>
              {": "}
              {item.found ? t("projectPage.harness.found") : t("projectPage.harness.missing")}
              {shows && <span className="text-muted-foreground"> ({shows})</span>}
            </li>
          );
        })}
      </Stack>
    </Panel>
  );
}

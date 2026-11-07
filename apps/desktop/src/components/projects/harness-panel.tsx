import type { ProjectLoad } from "@flightdeck/protocol";
import { Panel } from "@/components/layout/panel";
import { Stack } from "@/components/layout/stack";
import type { AppStore } from "@/lib/app-store";
import { type HarnessItem, harnessParts } from "@/lib/harness";

type T = AppStore["i18n"]["t"];

const PART = {
  claudeMd: "projectPage.harness.parts.claudeMd",
  hooks: "projectPage.harness.parts.hooks",
  skills: "projectPage.harness.parts.skills",
  agents: "projectPage.harness.parts.agents",
  permissions: "projectPage.harness.parts.permissions",
  mcp: "projectPage.harness.parts.mcp",
} as const;

const KIND = {
  format: "projectPage.harness.kinds.format",
  gitAdd: "projectPage.harness.kinds.gitAdd",
  secrets: "projectPage.harness.kinds.secrets",
} as const;

/** What shows a part: its names, the kinds of its hooks, or how many allow rules it has. */
function detail(item: HarnessItem, t: T): string {
  if (item.part === "hooks") {
    return item.detail.map((kind) => t(KIND[kind as keyof typeof KIND])).join(", ");
  }
  if (item.part === "permissions" && item.found) {
    const [n = "0", m] = item.detail;
    return m === undefined
      ? t("projectPage.harness.rulesAllow", { n })
      : t("projectPage.harness.rules", { n, m });
  }
  return item.detail.join(", ");
}

/**
 * Issue #75, slice S1: the project's Claude Code setup as a checklist, from the listing the trust
 * panel read (#196): one read for both. Read-only: it says what is there and what is missing.
 */
export function HarnessPanel(props: Readonly<{ load: ProjectLoad; t: T }>) {
  const { load, t } = props;
  const items = harnessParts(load);
  const found = items.filter((item) => item.found).length;
  return (
    <Panel title={t("projectPage.harness.title")} label={t("projectPage.harness.title")}>
      <p className="text-muted-foreground text-xs">{t("projectPage.harness.hint")}</p>
      <p className="font-medium text-sm">
        {t("projectPage.harness.summary", { n: found, total: items.length })}
      </p>
      {load.unreadable.length > 0 && (
        <p className="text-sm">{t("projectPage.harness.unreadable")}</p>
      )}
      <Stack as="ul" gap={1} className="text-sm">
        {items.map((item) => {
          const name = t(PART[item.part]);
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

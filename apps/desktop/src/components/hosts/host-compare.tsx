import { TriangleAlert } from "lucide-react";
import { memo, useId, useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { FieldRow } from "@/components/layout/form";
import { Panel } from "@/components/layout/panel";
import { Stack } from "@/components/layout/stack";
import { WideTable } from "@/components/layout/wide-table";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import { useStoreSlice } from "@/lib/use-store";
import type { Key, T } from "../../i18n/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import {
  type CompareCell,
  type CompareField,
  type CompareRow,
  compareHosts,
  hostFacts,
} from "../../lib/host-compare.ts";

const COMPARE_KEYS = ["hosts", "doctor", "deps"] as const;
const DASH = "—";
/** The first column stays in view while the table scrolls sideways. */
const STICKY = " sticky left-0 z-1 bg-background";
const CORNER = `py-1 pr-3${STICKY}`;
const ROW_HEADER = `py-1 pr-3 align-top font-normal${STICKY}`;

const HOOK_WORDS: Record<string, Key> = {
  ok: "hostCompare.hooks.ok",
  warn: "hostCompare.hooks.warn",
  fail: "hostCompare.hooks.fail",
};
const SIGNIN_WORDS: Record<string, Key> = {
  ok: "hostCompare.signin.ok",
  outdated: "hostCompare.signin.outdated",
  missing: "hostCompare.signin.missing",
  na: "hostCompare.signin.na",
};

/** A value as the person reads it: the word for a status, the count of a feature set, a version as is. */
function shown(field: CompareField, value: string, t: T): string {
  if (field === "hooks") return t(HOOK_WORDS[value] ?? "hostCompare.unknown");
  if (field === "signin") return t(SIGNIN_WORDS[value] ?? "hostCompare.unknown");
  if (field === "features") return String(value === "" ? 0 : value.split(",").length);
  return value;
}

function Cell(props: Readonly<{ cell: CompareCell; row: CompareRow; t: T }>) {
  const { cell, row, t } = props;
  const padding = "py-1 pr-3 align-top";
  if (cell.value === null) {
    return (
      <td className={padding}>
        <span aria-hidden="true">{DASH}</span>
        <span className="sr-only">{t("hostCompare.unknown")}</span>
      </td>
    );
  }
  const value = shown(row.field, cell.value, t);
  if (!cell.marked) return <td className={padding}>{value}</td>;
  const why =
    row.field === "features"
      ? t("hostCompare.differsFeatures")
      : t("hostCompare.differs", { value: shown(row.field, row.majority ?? cell.value, t) });
  return (
    <td className={padding}>
      <span className="inline-flex items-center gap-1 font-medium text-status-needs-you">
        <TriangleAlert aria-hidden="true" className="size-3.5" />
        {value}
      </span>
      <span className="block text-muted-foreground text-xs">{why}</span>
    </td>
  );
}

/**
 * The Compare hosts panel (#1501): each host's versions, hooks, sign-in and features side by side,
 * with the cell that differs from what most hosts have marked and its reason said in words. What
 * the table shows is what the app already holds; the hosts are asked again (the health read, which
 * is where `doctor.run` runs) only when it is opened and on Refresh, never on a render.
 */
export const HostCompare = memo(function HostCompare(props: Readonly<{ store: AppStore }>) {
  const { store } = props;
  const t = useT();
  const state = useStoreSlice(store, COMPARE_KEYS);
  const [open, setOpen] = useState(false);
  const tableId = useId();
  const { hosts } = state;
  if (hosts.length < 2) return null;
  const refresh = async () => {
    await Promise.all(
      hosts.filter((host) => host.status === "online").map((host) => store.checkHealth(host.id)),
    );
  };
  const rows = compareHosts(
    hosts.map((host) =>
      hostFacts({
        hostId: host.id,
        online: host.status === "online",
        info: host.hostInfo ?? undefined,
        doctor: state.doctor[host.id],
        deps: state.deps[host.id],
      }),
    ),
  );
  const toggle = () => {
    setOpen(!open);
    if (!open) void refresh();
  };
  return (
    <Panel title={t("hostCompare.title")} label={t("hostCompare.title")} slot="host-compare">
      <Stack gap={3}>
        <p className="text-muted-foreground text-sm">{t("hostCompare.intro")}</p>
        <FieldRow>
          <Button
            variant="outline"
            size="sm"
            aria-expanded={open}
            aria-controls={tableId}
            onClick={toggle}
          >
            {t(open ? "hostCompare.hide" : "hostCompare.show")}
          </Button>
          {open && (
            <ActionButton variant="outline" size="sm" onClick={refresh}>
              {t("hostCompare.refresh")}
            </ActionButton>
          )}
        </FieldRow>
        <div id={tableId}>
          {open && (
            <WideTable name={t("hostCompare.table")}>
              <table aria-label={t("hostCompare.table")} className="w-full text-left text-sm">
                <thead>
                  <tr>
                    <td className={CORNER} />
                    {hosts.map((host) => (
                      <th key={host.id} scope="col" className="py-1 pr-3 font-medium">
                        {host.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.field} className="border-t">
                      <th scope="row" className={ROW_HEADER}>
                        {t(`hostCompare.fields.${row.field}` as Key)}
                      </th>
                      {row.cells.map((cell) => (
                        <Cell key={cell.hostId} cell={cell} row={row} t={t} />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </WideTable>
          )}
        </div>
      </Stack>
    </Panel>
  );
});

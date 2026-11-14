import { TriangleAlert } from "lucide-react";
import { memo, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import { useStoreSlice } from "@/lib/use-store";
import { cn } from "@/lib/utils";
import { ActionButton } from "@/shared/feedback/index.ts";
import { FieldRow, Panel, Stack, WideTable } from "@/shared/layout/index.ts";
import type { Key, T } from "../../i18n/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import {
  type CompareCell,
  type CompareField,
  type CompareRow,
  compareHosts,
  featureDiff,
  featureDiffTied,
  hasFix,
  hostFacts,
} from "./domain/host-compare-model.ts";

const COMPARE_KEYS = ["hosts", "doctor", "deps", "healthError"] as const;
const DASH = "—";
/** A long list of differing features shows this many, then "and N more". */
const FOLD_AT = 3;
/** The first column stays in view while the table scrolls sideways. */
const STICKY = " sticky left-0 z-1 bg-background";
const CORNER = `py-1 pr-3${STICKY}`;
const ROW_HEADER = `py-1 pr-3 align-top font-normal${STICKY}`;

const HOOK_WORDS: Record<string, Key> = {
  ok: "hostCompare.hooks.ok",
  outdated: "hostCompare.hooks.outdated",
  missing: "hostCompare.hooks.missing",
};
const SIGNIN_WORDS: Record<string, Key> = {
  ok: "hostCompare.signin.ok",
  outdated: "hostCompare.signin.outdated",
  missing: "hostCompare.signin.missing",
  na: "hostCompare.signin.na",
};
const TOOL_WORDS: Record<string, Key> = {
  ok: "hostCompare.tool.ok",
  outdated: "hostCompare.tool.outdated",
  missing: "hostCompare.tool.missing",
  na: "hostCompare.tool.na",
};
const BOOT_WORDS: Record<string, Key> = {
  ok: "hostCompare.boot.ok",
  outdated: "hostCompare.boot.outdated",
  missing: "hostCompare.boot.missing",
  na: "hostCompare.boot.na",
};
const OS_WORDS: Record<string, Key> = {
  linux: "hostCompare.os.linux",
  darwin: "hostCompare.os.darwin",
  win32: "hostCompare.os.win32",
};
/** The words of the fields whose value is a status; an unknown one reads as not known. */
const WORDS: Partial<Record<CompareField, Record<string, Key>>> = {
  hooks: HOOK_WORDS,
  signin: SIGNIN_WORDS,
  gh: TOOL_WORDS,
  az: TOOL_WORDS,
  boot: BOOT_WORDS,
};

/** A value as the person reads it: the word for a status, the count of a feature set, a version as is. */
function shown(field: CompareField, value: string, t: T): string {
  if (field === "features") return String(value === "" ? 0 : value.split(",").length);
  if (field === "os") return t(OS_WORDS[value] ?? "hostCompare.unknown");
  const words = WORDS[field];
  return words ? t(words[value] ?? "hostCompare.unknown") : value;
}

/**
 * The features a host lacks or adds, in words ("no stall, no checkLoop"): the first few, then
 * "and N more" that opens the whole list in place.
 */
function FeatureDiffList(props: Readonly<{ missing: string[]; extra: string[]; t: T }>) {
  const { missing, extra, t } = props;
  const [all, setAll] = useState(false);
  const items = [
    ...missing.map((name) => t("hostCompare.featureMissing", { name })),
    ...extra.map((name) => t("hostCompare.featureExtra", { name })),
  ];
  const folded = items.length > FOLD_AT;
  const shownItems = folded && !all ? items.slice(0, FOLD_AT) : items;
  return (
    <span className="block text-muted-foreground text-xs">
      {shownItems.join(", ")}
      {folded && (
        <Button
          variant="link"
          size="sm"
          aria-expanded={all}
          onClick={() => setAll(!all)}
          className="h-auto p-0 pl-1 text-xs"
        >
          {all
            ? t("hostCompare.featuresFewer")
            : t("hostCompare.featuresMore", { n: items.length - FOLD_AT })}
        </Button>
      )}
    </span>
  );
}

/** The features a marked cell lacks or adds: against the majority, or against the others when tied. */
function featureDiffOf(row: CompareRow, value: string) {
  if (row.field !== "features") return null;
  return row.tied
    ? featureDiffTied(
        value,
        row.cells.map((c) => c.value),
      )
    : featureDiff(value, row.majority);
}

function Cell(
  props: Readonly<{
    cell: CompareCell;
    row: CompareRow;
    t: T;
    fix: (() => void) | null;
    host: string;
    /** The host is being read now: a fact it has not given yet is on its way, not unknown. */
    reading: boolean;
  }>,
) {
  const { cell, row, t, fix, host, reading } = props;
  const padding = "py-1 pr-3 align-top";
  if (cell.value === null && reading) {
    return <td className={cn(padding, "text-muted-foreground")}>{t("hostCompare.readingCell")}</td>;
  }
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
  const diff = featureDiffOf(row, cell.value);
  return (
    <td className={padding}>
      <span className="inline-flex items-center gap-1 font-medium text-status-needs-you">
        <TriangleAlert aria-hidden="true" className="size-3.5" />
        {value}
      </span>
      {diff ? (
        <FeatureDiffList missing={diff.missing} extra={diff.extra} t={t} />
      ) : (
        <span className="block text-muted-foreground text-xs">
          {row.tied
            ? t("hostCompare.differsTied")
            : t("hostCompare.differs", { value: shown(row.field, row.majority ?? cell.value, t) })}
        </span>
      )}
      {fix &&
        hasFix(
          row.field,
          cell.value,
          row.cells.map((c) => c.value),
        ) && (
          <Button variant="link" size="sm" onClick={fix}>
            {t("hostCompare.fix", { field: t(`hostCompare.fields.${row.field}` as Key), host })}
          </Button>
        )}
    </td>
  );
}

/**
 * The Compare hosts panel (#1501): each host's versions, hooks, sign-in and features side by side,
 * with the cell that differs from what most hosts have marked (every differing cell when there is no majority) and its reason said in words. What
 * the table shows is what the app already holds; the hosts are asked again (the health read, which
 * is where `doctor.run` runs) only when it is opened and on Refresh, never on a render.
 */
export const HostCompare = memo(function HostCompare(
  props: Readonly<{
    store: AppStore;
    /** The host whose page this is: its Health section is on the same page, so its fix asks that page for it. */
    hostId?: string;
  }>,
) {
  const { store } = props;
  const t = useT();
  const state = useStoreSlice(store, COMPARE_KEYS);
  const [open, setOpen] = useState(false);
  // #2652: the hosts whose health is being read now, and whether a read has ended since it opened.
  const [reading, setReading] = useState<readonly string[]>([]);
  const [finished, setFinished] = useState(false);
  const tableId = useId();
  const { hosts } = state;
  if (hosts.length < 2) return null;
  const refresh = async () => {
    const online = hosts.filter((host) => host.status === "online");
    setFinished(false);
    // Nobody to ask: there is nothing to say about a read.
    if (online.length === 0) return;
    setReading(online.map((host) => host.id));
    await Promise.all(
      online.map((host) =>
        store.health
          .check(host.id)
          .finally(() => setReading((ids) => ids.filter((id) => id !== host.id))),
      ),
    );
    setFinished(true);
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
    if (open) setFinished(false);
    else void refresh();
  };
  const nameOf = (id: string) => hosts.find((host) => host.id === id)?.name ?? id;
  const unanswered = hosts.filter((host) => host.status === "online" && state.healthError[host.id]);
  let status = "";
  if (open && reading.length > 0) {
    status = t("hostCompare.reading", { names: reading.map(nameOf).join(", ") });
  } else if (open && finished) {
    status =
      unanswered.length > 0
        ? t("hostCompare.readDoneFailed", { names: unanswered.map((host) => host.name).join(", ") })
        : t("hostCompare.readDone");
  }
  // The host page takes the ask (#2588): it scrolls to its Health heading and focuses it once the
  // panel shows, for the open host as for another one. The open one keeps its history entry.
  const fixFor = (hostId: string) => () => {
    const ask = { name: "host", host: hostId, section: "health" } as const;
    if (hostId === props.hostId) store.router.replace(ask);
    else store.router.push(ask);
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
        <output className="text-muted-foreground text-sm empty:hidden">{status}</output>
        <div id={tableId}>
          {open && (
            <WideTable name={t("hostCompare.table")}>
              <table
                aria-label={t("hostCompare.table")}
                aria-busy={reading.length > 0}
                className="w-full text-left text-sm"
              >
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
                  {rows.map((row, index) => (
                    <tr key={row.field} className="border-t">
                      <th scope="row" className={ROW_HEADER}>
                        {t(`hostCompare.fields.${row.field}` as Key)}
                      </th>
                      {row.cells.map((cell, column) => {
                        const host = hosts[column];
                        if (host && host.status !== "online") {
                          // One cell that says so, spanning every row, instead of a dash in each.
                          return index === 0 ? (
                            <td
                              key={cell.hostId}
                              rowSpan={rows.length}
                              className="py-1 pr-3 align-top text-muted-foreground"
                            >
                              {t("hostCompare.down", {
                                status: t(`hosts.status.${host.status}` as Key),
                              })}
                            </td>
                          ) : null;
                        }
                        return (
                          <Cell
                            key={cell.hostId}
                            cell={cell}
                            row={row}
                            t={t}
                            host={host?.name ?? cell.hostId}
                            reading={reading.includes(cell.hostId)}
                            fix={fixFor(cell.hostId)}
                          />
                        );
                      })}
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

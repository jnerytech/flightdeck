import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/context";
import type { Key } from "@/i18n/index";
import type { AppStore } from "@/lib/app-store";
import { useStoreSlice } from "@/lib/use-store";
import { LoadingState, WideTable } from "@/shared/layout/index.ts";
import { periodRange, usd } from "../costs/index.ts";
import { answeredHosts, failedHosts, type RoiAnswer } from "./domain/roi-answers.ts";
import { humanTokens, personRows } from "./domain/roi-people.ts";
import { RoiReadFailed } from "./roi-read-failed.tsx";

const DASH = "—";
const REFRESH_MS = 30_000;

/**
 * Phase 36: tokens against delivery, by person, for the month. A person is a named group of hosts
 * the app keeps; the table is a view, not a score: people are listed by name and the page says that
 * hosts are not people and that cost and delivery are only correlated.
 */
export function RoiPeople(props: Readonly<{ store: AppStore }>) {
  const { store } = props;
  const t = useT();
  // The people are the app's own settings: a person added or removed shows at once.
  useStoreSlice(store, ["roiRevision"]);
  const [answers, setAnswers] = useState<RoiAnswer[] | null>(null);
  // The read asked last is the one that counts; one that answers after the screen left is dropped.
  const latest = useRef(0);
  const load = useCallback(async () => {
    const mine = ++latest.current;
    const { from, to } = periodRange("month", store.roiFigures.today());
    const all = await store.roiFigures.summaries(from, to);
    if (mine === latest.current) setAnswers(all);
  }, [store]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      clearInterval(timer);
      latest.current++;
    };
  }, [load]);
  const failed = failedHosts(answers ?? []);
  // When no asked host answered, a table of zeros would read as "nobody delivered".
  const none = failed.length > 0 && answeredHosts(answers ?? []).length === 0;

  const rows = personRows(store.roi.data().people, answeredHosts(answers ?? []));
  const tokensText = (n: number) => {
    const human = humanTokens(n);
    return t(`roiUi.people.tokens.${human.unit}` as Key, { n: human.value });
  };
  const usedText = (row: (typeof rows)[number]) => {
    const parts: string[] = [];
    const { tokenLimit, costLimit } = row.person;
    if (tokenLimit && row.tokenShare !== null) {
      parts.push(
        t("roiUi.people.shareOfLimit", {
          share: Math.round(row.tokenShare * 100),
          limit: tokensText(tokenLimit),
        }),
      );
    }
    if (costLimit && row.costShare !== null) {
      parts.push(
        t("roiUi.people.shareOfLimit", {
          share: Math.round(row.costShare * 100),
          limit: usd(costLimit, t.lang),
        }),
      );
    }
    return parts.length > 0
      ? parts.join("; ")
      : t("roiUi.people.noLimit", { used: tokensText(row.tokens) });
  };

  return (
    <section aria-label={t("roiUi.people.title")} className="flex flex-col gap-2">
      <h2 className="font-medium text-sm">{t("roiUi.people.title")}</h2>
      {rows.length === 0 && (
        <p className="text-muted-foreground text-sm">{t("roiUi.people.empty")}</p>
      )}
      {rows.length > 0 && answers === null && <LoadingState label={t("roiUi.loading")} />}
      {rows.length > 0 && failed.length > 0 && (
        <RoiReadFailed store={store} hostIds={failed} onRetry={() => void load()} />
      )}
      {rows.length > 0 && answers !== null && !none && (
        <>
          <WideTable name={t("roiUi.people.title")}>
            <table
              aria-label={t("roiUi.people.title")}
              className="w-full text-left text-sm tabular-nums"
            >
              <thead>
                <tr>
                  {(["person", "used", "delivered", "perCard"] as const).map((column) => (
                    <th key={column} scope="col" className="py-1 pr-3 font-medium">
                      {t(`roiUi.people.${column}` as Key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.person.id} className="border-t">
                    <th scope="row" className="py-1 pr-3 font-normal">
                      {row.person.name}
                    </th>
                    <td className="pr-3">{usedText(row)}</td>
                    <td className="pr-3">
                      {t("roiUi.people.cards", { n: row.cards })},{" "}
                      {t("roiUi.people.prs", { n: row.prsMerged })}
                    </td>
                    <td className="pr-3">
                      {row.tokensPerCard === null ? DASH : tokensText(row.tokensPerCard)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </WideTable>
          <p className="text-muted-foreground text-xs">{t("roiUi.people.note")}</p>
        </>
      )}
    </section>
  );
}

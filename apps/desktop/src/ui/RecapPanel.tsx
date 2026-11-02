import type { SessionRecap } from "@flightdeck/protocol";
import { useEffect, useState } from "react";
import { Panel } from "@/components/layout/panel";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import { useStoreSlice } from "@/lib/use-store";
import type { T } from "../i18n/index.ts";
import type { AppStore } from "../lib/app-store.ts";
import { usd } from "../lib/costs.ts";
import { hasFeature } from "../lib/version.ts";

const HOSTS = ["hosts"] as const;

/** The rows of a summary as label and text, in the order a person reads them. */
function rows(recap: SessionRecap, question: string | undefined, t: T): Array<[string, string]> {
  const list: Array<[string, string | null]> = [
    [t("recap.asked"), recap.asked],
    [t("recap.done"), recap.done],
    [
      t("recap.files"),
      recap.files.length === 0
        ? null
        : [
            recap.files.join(", "),
            recap.filesMore > 0 ? t("recap.filesMore", { n: recap.filesMore }) : "",
          ]
            .filter(Boolean)
            .join(" "),
    ],
    [t("recap.cost"), recap.costUsd === null ? null : usd(recap.costUsd)],
    [t("recap.question"), question ?? recap.question],
  ];
  return list.filter((row): row is [string, string] => row[1] !== null);
}

/**
 * Phase 30: the short summary of a session (what was asked and done, the files, the cost and the
 * open question), built by the host from the transcript. Nothing from a host that cannot give one.
 */
export function RecapPanel(props: {
  store: AppStore;
  hostId: string;
  claudeSessionId: string;
  /** The pending request, when the session waits for you. */
  question?: string;
  /** Changes when the session moves on, so the summary is read again. */
  stamp?: string;
}) {
  const t = useT();
  const { store, hostId, claudeSessionId, question, stamp } = props;
  const host = useStoreSlice(store, HOSTS).hosts.find((h) => h.id === hostId);
  const supported = hasFeature(host?.hostInfo?.features, "summary", false);
  // `undefined` while it loads, `null` when the host has none.
  const [recap, setRecap] = useState<SessionRecap | null | undefined>(undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `stamp` is how a session asks to be read again
  useEffect(() => {
    if (!supported) return;
    let current = true;
    void store
      .sessionRecap(hostId, claudeSessionId, question ? { question } : {})
      .then((got) => current && setRecap(got));
    return () => {
      current = false;
    };
  }, [store, hostId, claudeSessionId, question, supported, stamp]);

  if (!supported || recap === undefined) return null;
  const lines = recap ? rows(recap, question, t) : [];
  return (
    <Panel size="sm" label={t("recap.region")}>
      {lines.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("recap.empty")}</p>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          {lines.map(([label, text]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="break-words">{text}</dd>
            </div>
          ))}
        </dl>
      )}
      {lines.length > 0 && (
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void store.copyText(lines.map(([l, x]) => `${l}: ${x}`).join("\n"))}
          >
            {t("recap.copy")}
          </Button>
        </div>
      )}
    </Panel>
  );
}

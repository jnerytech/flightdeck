import type { SessionRecap } from "@flightdeck/protocol";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Panel } from "@/components/layout/panel";
import { Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import { useStoreSlice } from "@/lib/use-store";
import type { T } from "../i18n/index.ts";
import type { AppStore } from "../lib/app-store.ts";
import { usd } from "../lib/costs.ts";
import { recapPreview } from "../lib/recap-preview.ts";
import { hasFeature } from "../lib/version.ts";

const HOSTS = ["hosts"] as const;
/** How long to wait before asking again while the host has no summary for the session. */
const RETRY_MS = 8000;

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
  /** How long to wait before asking again while the host has no summary yet. */
  retryMs?: number;
}) {
  const t = useT();
  const { store, hostId, claudeSessionId, question, stamp, retryMs = RETRY_MS } = props;
  const host = useStoreSlice(store, HOSTS).hosts.find((h) => h.id === hostId);
  const supported = hasFeature(host?.hostInfo?.features, "summary", false);
  // `undefined` while it loads, `null` when the host has none.
  const [recap, setRecap] = useState<SessionRecap | null | undefined>(undefined);
  // Bumped to ask again while the host has none yet (its indexer catches up after the first turn).
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `stamp` is how a session asks to be read again
  useEffect(() => {
    if (!supported) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void store.sessionRecap(hostId, claudeSessionId, question ? { question } : {}).then((got) => {
      if (!current) return;
      setRecap(got);
      if (got === null) timer = setTimeout(() => setAttempt((n) => n + 1), retryMs);
    });
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [store, hostId, claudeSessionId, question, supported, stamp, attempt, retryMs]);

  // Folded to one line until opened: it is a card of the header, and the conversation comes first.
  const [open, setOpen] = useState(false);
  if (!supported || recap === undefined) return null;
  const lines = recap ? rows(recap, question, t) : [];
  return (
    <Panel size="sm" label={t("recap.region")} className="shrink-0" slot="recap">
      <div className="recap-head">
        <Button
          variant="ghost"
          size="sm"
          className="toggle-start shrink-0"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          {t("recap.region")}
        </Button>
        {!open && (
          <span
            data-slot="recap-preview"
            className="min-w-0 truncate text-muted-foreground text-sm"
          >
            {recap ? recapPreview(recap) : t("recap.empty")}
          </span>
        )}
      </div>
      {!open ? null : lines.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("recap.empty")}</p>
      ) : (
        <Stack gap={1} className="rows-scroll">
          {lines.map(([label, text]) => (
            <p key={label} className="break-words text-sm">
              <span className="text-muted-foreground">{label}</span> {text}
            </p>
          ))}
        </Stack>
      )}
      {open && lines.length > 0 && (
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

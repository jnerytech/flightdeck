import type { SnippetHistoryCandidate } from "@flightdeck/protocol";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import type { AppStore } from "@/lib/app-store";

const SELECT = "h-9 rounded-md border bg-transparent px-2";
// The daemon's tag for imported lines (data, not text on screen), so both tag the same way.
const IMPORT_TAG = "hist\u00f3rico";
/** The vault's kind in the hidden-line note; the daemon names the pattern kinds. */
const VAULT_KIND = "valor do cofre";

/** A line as shown: the daemon's verdict plus the app's own check against the vault's values. */
interface Line {
  id: string;
  command: string | null;
  count: number;
  kinds: string[];
}

/** A name for a global snippet from its command: its first words, free among the globals. */
function freeName(command: string, taken: Set<string>): string {
  const base =
    command
      .split(/\s+/)
      .slice(0, 3)
      .join("-")
      .replace(/[^\p{L}\p{N}._-]/gu, "")
      .slice(0, 40) || "comando";
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
  taken.add(name);
  return name;
}

/**
 * Phase 18: the shell history of the host as candidates for snippets, read only. A line with a
 * secret, by the daemon's patterns or by a value of this app's vault, is hidden and locked; the
 * vault's values are compared here and never sent anywhere.
 */
export function HistoryImport(props: { store: AppStore; hostId: string; onImported(): void }) {
  const t = useT();
  const id = useId();
  const { store, hostId } = props;
  const [lines, setLines] = useState<Line[] | null>(null);
  const [reveal, setReveal] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<"host" | "global">("host");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const preview = await store.hostCommand(hostId, "snippets.importHistory", { reveal });
      const values = await store.vaultValuesForScan();
      if (!alive || !preview) return;
      setLines(
        preview.candidates.map((c: SnippetHistoryCandidate): Line => {
          const inVault = c.command !== null && values.some((v) => c.command?.includes(v));
          const kinds = inVault ? [...c.flagged, VAULT_KIND] : c.flagged;
          return { id: c.id, command: inVault ? null : c.command, count: c.count, kinds };
        }),
      );
    })();
    return () => {
      alive = false;
    };
  }, [store, hostId, reveal]);

  const toggle = (lineId: string, on: boolean) =>
    setPicked((current) => {
      const next = new Set(current);
      if (on) next.add(lineId);
      else next.delete(lineId);
      return next;
    });

  const importPicked = async () => {
    const chosen = (lines ?? []).filter((l) => picked.has(l.id) && l.kinds.length === 0);
    if (target === "host") {
      const result = await store.hostCommand(hostId, "snippets.importHistory", {
        select: chosen.map((l) => l.id),
      });
      if (!result) return;
      setMessage(t("snippets.history.imported", { n: result.created.length }));
    } else {
      const taken = new Set(store.globalSnippets.list().map((s) => s.name));
      for (const line of chosen) {
        store.globalSnippets.save({
          name: freeName(line.command ?? "", taken),
          type: "command",
          run: line.command ?? "",
          tags: [IMPORT_TAG],
        });
      }
      setMessage(t("snippets.history.imported", { n: chosen.length }));
    }
    setPicked(new Set());
    props.onImported();
  };

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-lg border p-4 text-sm">
      {lines === null ? null : (
        <ul aria-label={t("snippets.history.list")} className="flex flex-col gap-1">
          {lines.map((line) => (
            <li key={line.id} className="flex flex-wrap items-center gap-2">
              {line.kinds.length === 0 ? (
                <label className="flex items-center gap-2 font-mono">
                  <input
                    type="checkbox"
                    checked={picked.has(line.id)}
                    onChange={(e) => toggle(line.id, e.target.checked)}
                  />
                  {line.command}
                </label>
              ) : line.command !== null ? (
                <span className="font-mono text-muted-foreground">{line.command}</span>
              ) : (
                <span className="text-muted-foreground">
                  {t("snippets.history.hidden", { kinds: line.kinds.join(", ") })}
                </span>
              )}
              <span className="text-muted-foreground text-xs">
                {t("snippets.history.count", { n: line.count })}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-target`}>{t("snippets.history.target")}</label>
          <select
            id={`${id}-target`}
            className={SELECT}
            value={target}
            onChange={(e) => setTarget(e.target.value as "host" | "global")}
          >
            <option value="host">{t("snippets.history.toHost")}</option>
            <option value="global">{t("snippets.globals")}</option>
          </select>
        </div>
        <Button disabled={picked.size === 0} onClick={() => void importPicked()}>
          {t("snippets.history.import")}
        </Button>
        {!reveal && (
          <Button variant="outline" onClick={() => setReveal(true)}>
            {t("snippets.history.reveal")}
          </Button>
        )}
      </div>
      {message && <p role="status">{message}</p>}
    </div>
  );
}

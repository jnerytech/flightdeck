import type { SshImportEntry } from "@flightdeck/protocol";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";

/** The names of the host's `~/.ssh/config` that could become destinos; the registered ones are marked. */
export function ImportPanel(props: {
  entries: SshImportEntry[];
  onApply(aliases: string[]): void;
  onClose(): void;
}) {
  const t = useT();
  const [picked, setPicked] = useState(
    () => new Set(props.entries.filter((entry) => !entry.exists).map((entry) => entry.alias)),
  );
  const toggle = (alias: string, on: boolean) =>
    setPicked((current) => {
      const next = new Set(current);
      if (on) next.add(alias);
      else next.delete(alias);
      return next;
    });

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-lg border p-4">
      {props.entries.length === 0 ? (
        <p>{t("connections.import.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {props.entries.map((entry) => (
            <li key={entry.alias} className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={picked.has(entry.alias)}
                  disabled={entry.exists}
                  onChange={(event) => toggle(entry.alias, event.target.checked)}
                />
                {entry.alias}
              </label>
              <span className="font-mono text-muted-foreground">
                {`${entry.user}@${entry.host}${entry.port === 22 ? "" : `:${entry.port}`}`}
              </span>
              {entry.exists && <span>{t("connections.import.exists")}</span>}
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Button
          disabled={picked.size === 0}
          onClick={() =>
            props.onApply(props.entries.filter((e) => picked.has(e.alias)).map((e) => e.alias))
          }
        >
          {t("connections.import.apply")}
        </Button>
        <Button variant="ghost" onClick={props.onClose}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}

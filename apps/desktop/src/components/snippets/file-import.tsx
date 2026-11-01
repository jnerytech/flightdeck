import { type SnippetInput, SnippetModelError } from "@flightdeck/protocol";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import { refusalText } from "@/i18n/errors";
import type { AppStore } from "@/lib/app-store";

const SELECT = "h-9 rounded-md border bg-transparent px-2";

/**
 * Phase 18: snippets from a YAML or JSON file. The host's daemon reads it (the app has no YAML
 * parser) with the versioned file's own rules, so a secret or a bad entry is left out with the
 * reason; nothing is saved until the person imports.
 */
export function FileImport(props: { store: AppStore; hostId: string; onImported(): void }) {
  const t = useT();
  const id = useId();
  const { store, hostId } = props;
  const [found, setFound] = useState<{ snippets: SnippetInput[]; errors: string[] } | null>(null);
  const [target, setTarget] = useState<"host" | "global">("host");
  const [message, setMessage] = useState<string[]>([]);

  const read = async (file: File | undefined) => {
    if (!file) return;
    setMessage([]);
    const parsed = await store.hostCommand(hostId, "snippets.parse", { text: await file.text() });
    if (parsed) setFound(parsed);
  };

  const importAll = async () => {
    if (!found) return;
    const failed: string[] = [];
    let done = 0;
    for (const snippet of found.snippets) {
      if (target === "host") {
        const saved = await store.hostRequest(hostId, "snippets.save", {
          ...snippet,
          scope: "host",
        });
        if (saved.ok) done++;
        else failed.push(`${snippet.name}: ${refusalText(saved.code, saved.message, t, saved)}`);
      } else {
        try {
          store.globalSnippets.save(snippet);
          done++;
        } catch (thrown) {
          if (!(thrown instanceof SnippetModelError)) throw thrown;
          failed.push(`${snippet.name}: ${refusalText(thrown.code, thrown.message, t, thrown)}`);
        }
      }
    }
    setFound(null);
    setMessage([t("snippets.history.imported", { n: done }), ...failed]);
    props.onImported();
  };

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-lg border p-4 text-sm">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-file`}>{t("snippets.file.choose")}</label>
        <input
          id={`${id}-file`}
          type="file"
          accept=".yaml,.yml,.json"
          onChange={(e) => void read(e.target.files?.[0])}
        />
      </div>
      {found && (
        <>
          <ul aria-label={t("snippets.file.found")} className="flex flex-col gap-1 font-mono">
            {found.snippets.map((s) => (
              <li key={s.name}>{s.name}</li>
            ))}
          </ul>
          {found.errors.length > 0 && (
            <ul aria-label={t("snippets.file.errors")} className="list-disc pl-5 text-destructive">
              {found.errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-target`}>{t("snippets.file.target")}</label>
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
            <Button disabled={found.snippets.length === 0} onClick={() => void importAll()}>
              {t("snippets.file.import")}
            </Button>
          </div>
        </>
      )}
      {message.length > 0 && (
        <div role="status">
          {message.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
    </div>
  );
}

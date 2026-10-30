import type { SessionFile } from "@flightdeck/protocol";
import { useEffect, useState } from "react";
import { useT } from "@/i18n/context";
import type { AppStore } from "../lib/app-store.ts";

/**
 * The files a session wrote, from its transcripts (`session.files`): path, how many tool calls
 * and when. Changes made through Bash never show up here, and the text says so.
 */
export function SessionFiles(props: { store: AppStore; hostId: string; claudeSessionId: string }) {
  const t = useT();
  const { store, hostId, claudeSessionId } = props;
  const [files, setFiles] = useState<SessionFile[] | null>(null);

  useEffect(() => {
    void store
      .hostCommand(hostId, "session.files", { claudeSessionId })
      .then((result) => setFiles(result?.files ?? []));
  }, [store, hostId, claudeSessionId]);

  if (files === null) return null;
  return (
    <section className="flex flex-col gap-2">
      {files.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("changes.sessionFilesNone")}</p>
      ) : (
        <ul aria-label={t("changes.sessionFiles")} className="flex flex-col gap-1 text-sm">
          {files.map((file) => (
            <li key={file.path} className="flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-xs">{file.path}</span>
              <span className="text-muted-foreground text-xs tabular-nums">
                {[
                  t("changes.sessionEdits", { n: file.edits }),
                  t("changes.sessionLast", { when: store.formatDateTime(file.lastAt) }),
                ].join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-muted-foreground text-xs">{t("changes.bashNote")}</p>
    </section>
  );
}

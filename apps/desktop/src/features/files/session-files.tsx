import type { SessionFile } from "@flightdeck/protocol";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import { FieldRow } from "@/shared/layout/index.ts";
import type { AppStore } from "../../lib/app-store.ts";

/**
 * The files a session wrote, from its transcripts (`session.files`): path, how many tool calls
 * and when. Changes made through Bash never show up here, and the text says so. It sits under the
 * diff, another source: its heading names its own, and with none its line says where the diff's
 * changes came from instead of claiming nothing was written (#1128). A refused read is not an
 * empty list: it says the files could not be read, with Try again (#4489).
 */
export function SessionFiles(
  props: Readonly<{ store: AppStore; hostId: string; claudeSessionId: string }>,
) {
  const t = useT();
  const { store, hostId, claudeSessionId } = props;
  const titleId = useId();
  /** The files, `failed` when the host refused, or `null` while the first read runs. */
  const [files, setFiles] = useState<SessionFile[] | "failed" | null>(null);
  /** Try again is asking: the failure block stays, so the focus stays on its button. */
  const [retrying, setRetrying] = useState(false);
  const [reads, setReads] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `reads` only asks again, after Try again
  useEffect(() => {
    let live = true;
    void store.hostCommand(hostId, "session.files", { claudeSessionId }).then((result) => {
      if (!live) return;
      setFiles(result ? result.files : "failed");
      setRetrying(false);
    });
    return () => {
      live = false;
    };
  }, [store, hostId, claudeSessionId, reads]);

  if (files === null) return null;
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2">
      <h3 id={titleId} className="font-medium text-sm">
        {t("changes.sessionFilesTitle")}
      </h3>
      {files === "failed" ? (
        <FieldRow>
          {retrying ? (
            <output className="text-muted-foreground text-sm">
              {t("changes.sessionFilesLoading")}
            </output>
          ) : (
            <p role="alert" className="text-sm text-status-error">
              {t("changes.sessionFilesFailed")}
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => {
              if (retrying) return;
              setRetrying(true);
              setReads((n) => n + 1);
            }}
          >
            {t("changes.sessionFilesRetry")}
          </Button>
        </FieldRow>
      ) : files.length === 0 ? (
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
      {files !== "failed" && files.length > 0 && (
        <p className="text-muted-foreground text-xs">{t("changes.bashNote")}</p>
      )}
    </section>
  );
}

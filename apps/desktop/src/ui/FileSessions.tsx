import type { FileSession } from "@flightdeck/protocol";
import { History } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useT } from "@/i18n/context";
import type { AppStore } from "../lib/app-store.ts";

/** "Sessões que mexeram aqui": which sessions wrote a file, from the transcripts the host indexed. */
export function FileSessions(props: {
  store: AppStore;
  hostId: string;
  root: string;
  path: string;
}) {
  const t = useT();
  const { store } = props;
  const [sessions, setSessions] = useState<FileSession[] | null>(null);
  const label = t("changes.sessionsHere", { path: props.path });
  const load = (open: boolean) => {
    if (!open) return;
    setSessions(null);
    void store
      .hostCommand(props.hostId, "files.sessions", { path: `${props.root}/${props.path}` })
      .then((result) => setSessions(result?.sessions ?? []));
  };
  return (
    <Popover onOpenChange={load}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={label} title={label}>
          <History aria-hidden="true" className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        {sessions !== null && sessions.length === 0 && (
          <p className="text-muted-foreground text-sm">{t("changes.sessionsNone")}</p>
        )}
        {sessions !== null && sessions.length > 0 && (
          <ul aria-label={t("changes.sessionsList")} className="flex flex-col gap-2 text-sm">
            {sessions.map((session) => (
              <li key={session.claudeSessionId} className="flex flex-col">
                <span className="truncate font-medium">
                  {session.title ?? session.claudeSessionId}
                </span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {[
                    t("changes.sessionEdits", { n: session.edits }),
                    t("changes.sessionSpan", {
                      from: store.formatDateTime(session.firstAt),
                      to: store.formatDateTime(session.lastAt),
                    }),
                  ].join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-muted-foreground text-xs">{t("changes.bashNote")}</p>
      </PopoverContent>
    </Popover>
  );
}

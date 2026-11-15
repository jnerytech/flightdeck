import type { SnapshotFiles, SnapshotInfo } from "@flightdeck/protocol";
import { GitBranch, History, Undo2 } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { type Turn, turnsOf } from "@/features/sessions/index.ts";
import { IconActionButton, InlineNotice } from "@/shared/feedback/index.ts";
import { EmptyState, LoadingState } from "@/shared/layout/index.ts";
import { formatDateTime } from "../../i18n/format.ts";
import type { AppStore } from "../../lib/app-store.ts";
import { ForkDialog, RewindDialog, type Target } from "./checkpoint-dialogs.tsx";

/** One turn: its prompt, time and files, and the two actions. */
function TurnRow(
  props: Readonly<{
    store: AppStore;
    turn: Turn;
    busy: boolean;
    /** The id of the panel's busy notice, which says why the rewind is off. */
    busyId: string;
    files: SnapshotFiles | undefined;
    onToggle(): void;
    onRewind(): void;
    onFork(): void;
  }>,
) {
  const { store, turn } = props;
  const { t } = store.i18n;
  const noUuidId = useId();
  const summary = {
    changed: t("timeline.changed"),
    unchanged: t("timeline.unchanged"),
    running: t("timeline.running"),
    unknown: t("timeline.unknown"),
  }[turn.files];
  return (
    <li className="flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{t("timeline.turn", { n: turn.ordinal })}</Badge>
        <time className="text-muted-foreground text-xs" dateTime={turn.createdAt}>
          {formatDateTime(turn.createdAt, store.i18n.lang)}
        </time>
        <Badge variant={turn.files === "changed" ? "secondary" : "outline"}>{summary}</Badge>
      </div>
      <p className="line-clamp-3 whitespace-pre-wrap break-words">{turn.prompt ?? ""}</p>
      {turn.files === "changed" && (
        <div className="flex flex-col gap-1">
          <Button variant="ghost" size="sm" className="self-start" onClick={props.onToggle}>
            {props.files
              ? t("timeline.hideFiles", { n: turn.ordinal })
              : t("timeline.showFiles", { n: turn.ordinal })}
          </Button>
          {props.files && (
            <ul className="flex flex-col gap-1">
              {props.files.files.map((file) => (
                <li key={file.path} className="flex flex-wrap items-center gap-2">
                  <code className="break-all">{file.path}</code>
                  <span className="text-muted-foreground text-xs">
                    {t(`timeline.change.${file.change as "modified" | "created" | "deleted"}`)}
                  </span>
                </li>
              ))}
              <li className="text-muted-foreground text-xs tabular-nums">
                {t("timeline.lines", {
                  added: props.files.insertions,
                  removed: props.files.deletions,
                })}
              </li>
            </ul>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={props.busy}
          aria-describedby={props.busy ? props.busyId : undefined}
          aria-label={t("timeline.rewindTurn", { n: turn.ordinal })}
          onClick={props.onRewind}
        >
          <Undo2 aria-hidden="true" />
          {t("timeline.rewind")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={turn.uuid === null}
          aria-describedby={turn.uuid === null ? noUuidId : undefined}
          aria-label={t("timeline.forkTurn", { n: turn.ordinal })}
          onClick={props.onFork}
        >
          <GitBranch aria-hidden="true" />
          {t("timeline.fork")}
        </Button>
      </div>
      {turn.uuid === null && (
        <p id={noUuidId} className="text-muted-foreground text-xs">
          {t("timeline.noUuid")}
        </p>
      )}
    </li>
  );
}

/** The turns of a session and what can be done from each one. */
function TimelinePanel(props: Target & { busy: boolean; onOpenSession(sessionId: string): void }) {
  const { store, hostId, claudeSessionId } = props;
  const { t } = store.i18n;
  const busyId = useId();
  const [snapshots, setSnapshots] = useState<SnapshotInfo[] | null>(null);
  const [files, setFiles] = useState<Record<number, SnapshotFiles>>({});
  const [rewinding, setRewinding] = useState<Turn | null>(null);
  const [forking, setForking] = useState<Turn | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [undoable, setUndoable] = useState(false);

  const load = useCallback(async () => {
    const result = await store.hostCommand(hostId, "snapshots.list", { claudeSessionId });
    if (result) setSnapshots(result.snapshots);
  }, [store, hostId, claudeSessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (turn: Turn) => {
    if (files[turn.n]) {
      setFiles(({ [turn.n]: _closed, ...rest }) => rest);
      return;
    }
    const result = await store.hostCommand(hostId, "snapshots.files", {
      claudeSessionId,
      n: turn.n,
    });
    if (result) setFiles((all) => ({ ...all, [turn.n]: result }));
  };

  const rewound = (turn: Turn) => {
    setNotice(t("timeline.rewound", { n: turn.ordinal }));
    setUndoable(true);
    void load();
  };

  const undo = async () => {
    const result = await store.hostCommand(hostId, "rewind.undo", {
      claudeSessionId,
      confirm: true,
    });
    if (result) {
      setNotice(t("timeline.undone"));
      setUndoable(false);
      void load();
    }
  };

  if (snapshots === null) return <LoadingState label={t("timeline.loading")} />;
  const turns = turnsOf(snapshots);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
      {notice && (
        <InlineNotice tone="info">
          <span>{notice}</span>{" "}
          {undoable && (
            <Button variant="outline" size="sm" onClick={() => void undo()}>
              {t("timeline.undo")}
            </Button>
          )}
        </InlineNotice>
      )}
      {props.busy && <InlineNotice id={busyId}>{t("timeline.busy")}</InlineNotice>}
      {turns.length === 0 && <EmptyState icon={History} title={t("timeline.empty")} />}
      <ul aria-label={t("timeline.list")} className="flex flex-col gap-2">
        {turns.map((turn) => (
          <TurnRow
            key={turn.n}
            store={store}
            turn={turn}
            busy={props.busy}
            busyId={busyId}
            files={files[turn.n]}
            onToggle={() => void toggle(turn)}
            onRewind={() => setRewinding(turn)}
            onFork={() => setForking(turn)}
          />
        ))}
      </ul>
      {rewinding && (
        <RewindDialog
          {...props}
          turn={rewinding}
          onClose={() => setRewinding(null)}
          onDone={() => rewound(rewinding)}
        />
      )}
      {forking && (
        <ForkDialog
          {...props}
          turn={forking}
          onClose={() => setForking(null)}
          onRewound={() => rewound(forking)}
        />
      )}
    </div>
  );
}

/**
 * "Linha do tempo" (phase 12): the session's turns in a side sheet, with "Voltar arquivos até
 * aqui" and "Bifurcar daqui" on each. `busy`: the session is in a turn, so files cannot go back.
 */
export function CheckpointsButton(props: Target & { busy: boolean }) {
  const { store } = props;
  const { t } = store.i18n;
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconActionButton label={t("timeline.open")} onClick={() => setOpen(true)}>
        <History aria-hidden="true" />
      </IconActionButton>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent showCloseButton={false} className="sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{t("timeline.title")}</SheetTitle>
            <SheetDescription>{t("timeline.description")}</SheetDescription>
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => setOpen(false)}
            >
              {t("common.close")}
            </Button>
          </SheetHeader>
          <TimelinePanel
            {...props}
            onOpenSession={(id) => {
              setOpen(false);
              store.router.push({ name: "session", host: props.hostId, id });
            }}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}

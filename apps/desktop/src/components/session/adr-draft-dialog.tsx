import { useState } from "react";
import { AssistField } from "@/components/assistant/assist-field";
import { AppDialogContent } from "@/components/feedback/dialog-content";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n/context";
import { refusalText } from "@/i18n/errors";
import type { AppStore } from "@/lib/app-store";

/**
 * Issue #1039: a decision record drafted from a session's summary. The summary is the starting
 * text; the assistant's wand writes an ADR from it, and the person edits it. Saving hands the
 * host a new ADR with that text: a draft in the project's library, not committed.
 */
export function AdrDraftDialog(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    /** The project folder whose library the record goes into. */
    path: string;
    /** The session summary the draft starts from. */
    summary: string;
    onClose(): void;
  }>,
) {
  const { store, hostId, path } = props;
  const t = useT();
  const [title, setTitle] = useState("");
  const [text, setText] = useState(props.summary);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const done = note?.ok === true;
  const save = async () => {
    setBusy(true);
    const result = await store.hostRequest(hostId, "knowledge.create", {
      path,
      kind: "adr",
      title: title.trim(),
      body: text,
    });
    setBusy(false);
    setNote(
      result.ok
        ? { ok: true, text: t("adrDraft.saved", { path: result.data.path }) }
        : {
            ok: false,
            text: t("adrDraft.failed", {
              why: refusalText(result.code, result.message, t, result),
            }),
          },
    );
  };
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <AppDialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("adrDraft.title")}</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">{t("adrDraft.hint")}</p>
        <Input
          aria-label={t("adrDraft.titleLabel")}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <AssistField
          binding={{
            controller: store.assistant,
            kind: "adr.draft",
            fieldHostId: hostId,
            cwd: path,
            // The draft is written knowing the title the person is about to give it.
            ...(title.trim() ? { context: { title: title.trim() } } : {}),
            openSettings: store.openAssistantSettings,
          }}
          value={text}
          onChange={setText}
          t={t}
        >
          {(assist) => (
            <Textarea
              {...assist}
              aria-label={t("adrDraft.bodyLabel")}
              className="min-h-48"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          )}
        </AssistField>
        {note && (
          <p
            role={note.ok ? "status" : "alert"}
            className={note.ok ? "text-sm" : "text-destructive text-sm"}
          >
            {note.text}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={props.onClose}>
            {done ? t("common.close") : t("common.cancel")}
          </Button>
          <Button
            type="button"
            disabled={busy || done || title.trim() === "" || text.trim() === ""}
            onClick={() => void save()}
          >
            {t("adrDraft.save")}
          </Button>
        </DialogFooter>
      </AppDialogContent>
    </Dialog>
  );
}

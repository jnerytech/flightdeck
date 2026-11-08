import type { KnowledgeKind } from "@flightdeck/protocol";
import { useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { Field, FieldRow } from "@/components/layout/form";
import { Input } from "@/components/ui/input";
import type { Key } from "@/i18n";
import { refusalText } from "@/i18n/errors";
import type { AppStore } from "@/lib/app-store";

const KINDS: readonly KnowledgeKind[] = ["adr", "rfc", "prd"];

/**
 * A new library document from a template (issue #1039): a kind and a title. The host writes the
 * file in the project's folder for the kind, as a draft and uncommitted; this says which file.
 */
export function KnowledgeCreate(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    path: string;
    /** The list is read again after a document is made. */
    onCreated(): void;
  }>,
) {
  const { store, hostId, path, onCreated } = props;
  const { t } = store.i18n;
  const [kind, setKind] = useState<KnowledgeKind>("adr");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const create = async () => {
    setBusy(true);
    const result = await store.hostRequest(hostId, "knowledge.create", {
      path,
      kind,
      title: title.trim(),
    });
    setBusy(false);
    if (result.ok) {
      setTitle("");
      setNote({
        ok: true,
        text: t("projectPage.knowledge.create.created", { path: result.data.path }),
      });
      onCreated();
    } else {
      // The title stays: a refusal is usually one more try away.
      setNote({
        ok: false,
        text: t("projectPage.knowledge.create.failed", {
          why: refusalText(result.code, result.message, t, result),
        }),
      });
    }
  };
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      <h4 className="font-medium text-sm">{t("projectPage.knowledge.create.title")}</h4>
      <p className="text-muted-foreground text-sm">{t("projectPage.knowledge.create.hint")}</p>
      {/* #1104: each box shows what it is, and Create says what it waits for on its own line. */}
      <FieldRow align="end">
        <Field label={t("projectPage.knowledge.create.kind")}>
          {(control) => (
            <select
              {...control}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm"
              value={kind}
              onChange={(event) => setKind(event.target.value as KnowledgeKind)}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`projectPage.knowledge.create.${k}` as Key)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t("projectPage.knowledge.create.titleLabel")} className="min-w-0 flex-1">
          {(control) => (
            <Input {...control} value={title} onChange={(event) => setTitle(event.target.value)} />
          )}
        </Field>
        <ActionButton
          type="submit"
          variant="outline"
          pending={busy}
          disabled={title.trim() === ""}
          disabledReason={t("projectPage.knowledge.create.titleNeeded")}
        >
          {t("projectPage.knowledge.create.button")}
        </ActionButton>
      </FieldRow>
      {note && (
        <p role={note.ok ? "status" : "alert"} className="text-sm">
          {note.text}
        </p>
      )}
    </form>
  );
}

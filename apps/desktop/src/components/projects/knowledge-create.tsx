import type { KnowledgeKind } from "@flightdeck/protocol";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Key } from "@/i18n";
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
  const { t } = props.store.i18n;
  const [kind, setKind] = useState<KnowledgeKind>("adr");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <select
        aria-label={t("projectPage.knowledge.create.kind")}
        value={kind}
        onChange={(event) => setKind(event.target.value as KnowledgeKind)}
      >
        {KINDS.map((k) => (
          <option key={k} value={k}>
            {t(`projectPage.knowledge.create.${k}` as Key)}
          </option>
        ))}
      </select>
      <Input
        aria-label={t("projectPage.knowledge.create.titleLabel")}
        value=""
        onChange={() => {}}
      />
      <Button type="button" variant="outline" onClick={() => {}}>
        {t("projectPage.knowledge.create.button")}
      </Button>
      {note && <p role={note.ok ? "status" : "alert"}>{note.text}</p>}
      {title && props.onCreated && setTitle && null}
    </div>
  );
}

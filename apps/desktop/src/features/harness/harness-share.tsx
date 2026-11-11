import { useRef, useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { Field } from "@/components/layout/form";
import { Stack } from "@/components/layout/stack";
import { Input } from "@/components/ui/input";
import { refusalText } from "@/i18n/errors";
import type { AppStore } from "@/lib/app-store";
import { templateIdFrom } from "@/lib/harness";
import { ConfirmDialog } from "@/ui/ConfirmDialog";

export interface HarnessShareProps {
  store: AppStore;
  hostId: string;
  path: string;
}

/**
 * Issue #75, slice T2: shares the project's Markdown setup (CLAUDE.md, agents, skills; never
 * settings) as a host template, after the person named it. The id comes from the name; the host
 * scans every file and refuses a taken id, with its reason.
 */
export function HarnessShare(props: Readonly<HarnessShareProps>) {
  const { store, hostId, path } = props;
  const { t } = store.i18n;
  const [asking, setAsking] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ text: string; refused: boolean } | null>(null);
  // The outcome regions stay mounted, so a screen reader reads what fills them.
  const said = useRef<HTMLDivElement>(null);
  const refusedBox = useRef<HTMLDivElement>(null);
  const id = templateIdFrom(title);

  const share = async () => {
    const named = title.trim();
    setOutcome(null);
    setAsking(false);
    setBusy(true);
    const result = await store
      .hostRequest(hostId, "project.harness.export", { path, id, title: named })
      .finally(() => setBusy(false));
    if (!result.ok) {
      setOutcome({ text: refusalText(result.code, result.message, t, result), refused: true });
      refusedBox.current?.focus();
      return;
    }
    const n = result.data.files.length;
    setTitle("");
    setOutcome({
      text: t("projectPage.harness.share.done", {
        title: result.data.title,
        files:
          n === 1
            ? t("projectPage.harness.share.filesOne")
            : t("projectPage.harness.share.filesMany", { n }),
      }),
      refused: false,
    });
    said.current?.focus();
  };
  /** The name field says what is missing once something is typed, and the id it will get once there is one. */
  const nameNote = () => {
    if (title.trim() !== "" && id === "")
      return { error: t("projectPage.harness.share.needsName") };
    if (id !== "") return { help: t("projectPage.harness.share.idHint", { id }) };
    return {};
  };
  return (
    <Stack gap={2}>
      <div>
        <ActionButton variant="outline" pending={busy} onClick={() => setAsking(true)}>
          {t("projectPage.harness.share.action")}
        </ActionButton>
      </div>
      <div // NOSONAR: holds flow content (a paragraph), which <output> may not
        role="status"
        ref={said}
        tabIndex={-1}
        className="rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
      >
        {outcome && !outcome.refused && <p className="text-sm">{outcome.text}</p>}
      </div>
      <div
        role="alert"
        ref={refusedBox}
        tabIndex={-1}
        className="rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
      >
        {outcome?.refused && <p className="text-sm">{outcome.text}</p>}
      </div>
      {asking && (
        <ConfirmDialog
          message={t("projectPage.harness.share.message")}
          confirmLabel={t("projectPage.harness.share.confirm")}
          confirmDisabled={id === ""}
          onCancel={() => setAsking(false)}
          onConfirm={() => void share()}
        >
          <Field label={t("projectPage.harness.share.name")} {...nameNote()}>
            {(control) => (
              <Input
                {...control}
                autoFocus
                value={title}
                maxLength={80}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && id !== "") {
                    event.preventDefault();
                    void share();
                  }
                }}
              />
            )}
          </Field>
        </ConfirmDialog>
      )}
    </Stack>
  );
}

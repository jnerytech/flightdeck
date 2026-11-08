import type { HarnessTemplateInfo } from "@flightdeck/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { ListRow } from "@/components/layout/list-row";
import { Panel } from "@/components/layout/panel";
import { Inline, Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import type { AppStore } from "../lib/app-store.ts";
import { formatBytes } from "../lib/format-bytes.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

/**
 * The host's Claude Code setup templates (`harness.templates.*`, #75): the ones shared from a
 * project, each with a way to delete it. Deleting asks first, and sends the id with `confirm`.
 */
export function HarnessTemplatesSection(props: Readonly<{ store: AppStore; hostId: string }>) {
  const t = useT();
  const { store, hostId } = props;
  const [templates, setTemplates] = useState<HarnessTemplateInfo[] | null>(null);
  const [deleting, setDeleting] = useState<HarnessTemplateInfo | null>(null);
  const [failed, setFailed] = useState(false);
  // The Delete button that opened the dialog: a cancel gives the focus back to it.
  const opener = useRef<HTMLElement | null>(null);
  const cancelled = useRef(false);
  const refresh = useCallback(async () => {
    const next = await store.hostCommand(hostId, "harness.templates.list", {});
    setFailed(next === null);
    if (next) setTemplates(next.templates);
  }, [store, hostId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  // After the dialog is gone: its own focus return has nothing to go back to (no trigger).
  useEffect(() => {
    if (deleting !== null || !cancelled.current) return;
    cancelled.current = false;
    const id = setTimeout(() => opener.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [deleting]);

  const remove = async (template: HarnessTemplateInfo) => {
    setDeleting(null);
    // Not retried from the banner: a delete repeated later, unseen, would run without a question.
    const done = await store.hostCommand(
      hostId,
      "harness.templates.delete",
      { id: template.id, confirm: true },
      { retry: false },
    );
    await refresh();
    if (done) store.success(t("harnessTemplates.deleted", { title: template.title }));
  };
  const facts = (template: HarnessTemplateInfo) =>
    t("harnessTemplates.facts", {
      files:
        template.files.length === 1
          ? t("harnessTemplates.filesOne")
          : t("harnessTemplates.filesMany", { n: String(template.files.length) }),
      size: formatBytes(template.bytes),
    });
  return (
    <>
      <Panel title={t("harnessTemplates.title")} label={t("harnessTemplates.title")}>
        <p className="text-muted-foreground text-sm">{t("harnessTemplates.hint")}</p>
        {templates === null && !failed && (
          <p className="text-muted-foreground text-sm">{t("harnessTemplates.asking")}</p>
        )}
        {failed && (
          <Inline>
            <p className="text-sm">{t("harnessTemplates.loadFailed")}</p>
            <Button variant="outline" size="sm" onClick={() => void refresh()}>
              {t("harnessTemplates.retry")}
            </Button>
          </Inline>
        )}
        {templates?.length === 0 && <p className="text-sm">{t("harnessTemplates.none")}</p>}
        {templates && templates.length > 0 && (
          <Stack as="ul" gap={2}>
            {templates.map((template) => (
              <li key={template.id}>
                <ListRow
                  boxed
                  title={template.title}
                  meta={facts(template)}
                  trailing={
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={t("harnessTemplates.deleteLabel", { title: template.title })}
                      onClick={(event) => {
                        opener.current = event.currentTarget;
                        setDeleting(template);
                      }}
                    >
                      {t("harnessTemplates.delete")}
                    </Button>
                  }
                />
              </li>
            ))}
          </Stack>
        )}
      </Panel>
      {deleting && (
        <ConfirmDialog
          message={t("harnessTemplates.confirmMessage", { title: deleting.title })}
          warning={t("harnessTemplates.confirmWarning")}
          confirmLabel={t("harnessTemplates.confirmButton")}
          destructive
          onConfirm={() => void remove(deleting)}
          onCancel={() => {
            cancelled.current = true;
            setDeleting(null);
          }}
        />
      )}
    </>
  );
}

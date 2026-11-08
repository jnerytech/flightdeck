import type { HarnessTemplateInfo } from "@flightdeck/protocol";
import { useCallback, useEffect, useState } from "react";
import { ListRow } from "@/components/layout/list-row";
import { Panel } from "@/components/layout/panel";
import { Stack } from "@/components/layout/stack";
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
  const refresh = useCallback(async () => {
    const next = await store.hostCommand(hostId, "harness.templates.list", {});
    if (next) setTemplates(next.templates);
  }, [store, hostId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const remove = async (template: HarnessTemplateInfo) => {
    setDeleting(null);
    const done = await store.hostCommand(hostId, "harness.templates.delete", {
      id: template.id,
      confirm: true,
    });
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
    <section aria-label={t("harnessTemplates.title")}>
      <Panel title={t("harnessTemplates.title")}>
        <p className="text-muted-foreground text-sm">{t("harnessTemplates.hint")}</p>
        {templates === null && (
          <p className="text-muted-foreground text-sm">{t("harnessTemplates.asking")}</p>
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
                      onClick={() => setDeleting(template)}
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
          onCancel={() => setDeleting(null)}
        />
      )}
    </section>
  );
}
